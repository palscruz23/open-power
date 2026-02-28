from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    import pandapower as pp
    import pandapower.shortcircuit as sc
except ImportError:  # pragma: no cover
    pp = None
    sc = None


class Bus(BaseModel):
    id: str
    name: str
    vn_kv: float = Field(gt=0)


class Line(BaseModel):
    id: str
    from_bus: str
    to_bus: str
    length_km: float = Field(gt=0)
    r_ohm_per_km: float = Field(gt=0)
    x_ohm_per_km: float = Field(gt=0)
    c_nf_per_km: float = Field(ge=0)
    max_i_ka: float = Field(gt=0)


class Load(BaseModel):
    id: str
    bus: str
    p_mw: float
    q_mvar: float


class Generator(BaseModel):
    id: str
    bus: str
    p_mw: float
    vm_pu: float = 1.0


class NetworkInput(BaseModel):
    buses: List[Bus]
    lines: List[Line] = []
    loads: List[Load] = []
    generators: List[Generator] = []


app = FastAPI(title='Open Power Studio API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*']
)


def ensure_engine_available() -> None:
    if pp is None:
        raise HTTPException(
            status_code=503,
            detail='pandapower is not installed. Please `pip install -r backend/requirements.txt`.'
        )


def build_network(payload: NetworkInput):
    ensure_engine_available()

    if len(payload.buses) == 0:
        raise HTTPException(status_code=400, detail='At least one bus is required.')
    if len(payload.buses) > 20:
        raise HTTPException(status_code=400, detail='Maximum 20 buses supported in this release.')

    net = pp.create_empty_network(sn_mva=100.0)
    bus_map: Dict[str, int] = {}

    for bus in payload.buses:
        bus_map[bus.id] = pp.create_bus(net, vn_kv=bus.vn_kv, name=bus.name)

    for line in payload.lines:
        if line.from_bus not in bus_map or line.to_bus not in bus_map:
            raise HTTPException(status_code=400, detail=f'Invalid line bus reference: {line.id}')
        pp.create_line_from_parameters(
            net,
            from_bus=bus_map[line.from_bus],
            to_bus=bus_map[line.to_bus],
            length_km=line.length_km,
            r_ohm_per_km=line.r_ohm_per_km,
            x_ohm_per_km=line.x_ohm_per_km,
            c_nf_per_km=line.c_nf_per_km,
            max_i_ka=line.max_i_ka,
            name=line.id
        )

    for load in payload.loads:
        if load.bus not in bus_map:
            raise HTTPException(status_code=400, detail=f'Invalid load bus reference: {load.id}')
        pp.create_load(net, bus=bus_map[load.bus], p_mw=load.p_mw, q_mvar=load.q_mvar, name=load.id)

    slack_assigned = False
    for generator in payload.generators:
        if generator.bus not in bus_map:
            raise HTTPException(status_code=400, detail=f'Invalid generator bus reference: {generator.id}')
        if not slack_assigned:
            pp.create_ext_grid(net, bus=bus_map[generator.bus], vm_pu=generator.vm_pu, name=generator.id)
            slack_assigned = True
        else:
            pp.create_gen(
                net,
                bus=bus_map[generator.bus],
                p_mw=generator.p_mw,
                vm_pu=generator.vm_pu,
                name=generator.id
            )

    if not slack_assigned:
        pp.create_ext_grid(net, bus=bus_map[payload.buses[0].id], vm_pu=1.0, name='auto-slack')

    return net


@app.get('/health')
def health() -> Dict[str, str]:
    return {'status': 'ok'}


@app.post('/api/calculate/load-flow')
def calculate_load_flow(payload: NetworkInput):
    net = build_network(payload)

    try:
        pp.runpp(net)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Load flow failed: {exc}') from exc

    return {
        'buses': net.res_bus[['vm_pu', 'va_degree', 'p_mw', 'q_mvar']].round(5).to_dict('index'),
        'lines': (
            net.res_line[['loading_percent', 'p_from_mw', 'p_to_mw']].round(5).to_dict('index')
            if len(net.res_line) > 0
            else {}
        )
    }


@app.post('/api/calculate/short-circuit')
def calculate_short_circuit(payload: NetworkInput):
    if sc is None:
        raise HTTPException(status_code=503, detail='pandapower short-circuit module unavailable.')

    net = build_network(payload)

    try:
        sc.calc_sc(net, case='max')
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Short circuit failed: {exc}') from exc

    return {
        'buses': net.res_bus_sc[['ikss_ka', 'skss_mw']].round(5).to_dict('index')
        if len(net.res_bus_sc) > 0
        else {}
    }

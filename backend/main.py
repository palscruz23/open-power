from typing import Dict, List, Literal

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


class ShortCircuitInput(NetworkInput):
    fault_bus_id: str
    fault_type: Literal['three_phase', 'single_phase', 'earth_fault'] = 'three_phase'


app = FastAPI(title='OpenPower Studio API', version='0.1.0')

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
            detail=(
                'pandapower is not installed. '
                'Install with `pip install -r backend/requirements.txt` and use Python 3.12 on Windows '
                'for this pinned dependency set.'
            )
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
            name=line.id,
            r0_ohm_per_km=line.r_ohm_per_km,
            x0_ohm_per_km=line.x_ohm_per_km,
            c0_nf_per_km=line.c_nf_per_km
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
            pp.create_ext_grid(
                net,
                bus=bus_map[generator.bus],
                vm_pu=generator.vm_pu,
                name=generator.id,
                s_sc_max_mva=1000.0,
                s_sc_min_mva=500.0,
                rx_max=0.1,
                rx_min=0.1,
                x0x_max=1.0,
                x0x_min=1.0,
                r0x0_max=0.1,
                r0x0_min=0.1
            )
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
        pp.create_ext_grid(
            net,
            bus=bus_map[payload.buses[0].id],
            vm_pu=1.0,
            name='auto-slack',
            s_sc_max_mva=1000.0,
            s_sc_min_mva=500.0,
            rx_max=0.1,
            rx_min=0.1,
            x0x_max=1.0,
            x0x_min=1.0,
            r0x0_max=0.1,
            r0x0_min=0.1
        )

    return net, bus_map


@app.get('/health')
def health() -> Dict[str, str]:
    return {'status': 'ok'}


@app.post('/api/calculate/load-flow')
def calculate_load_flow(payload: NetworkInput):
    net, bus_map = build_network(payload)

    try:
        pp.runpp(net)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Load flow failed: {exc}') from exc

    index_to_bus_id = {index: bus_id for bus_id, index in bus_map.items()}

    buses: Dict[str, Dict[str, float]] = {}
    for bus_index, row in net.res_bus.iterrows():
        bus_id = index_to_bus_id.get(bus_index)
        if not bus_id:
            continue
        vn_kv = float(net.bus.loc[bus_index, 'vn_kv'])
        vm_pu = float(row['vm_pu'])
        buses[bus_id] = {
            'vm_pu': round(vm_pu, 5),
            'vm_kv': round(vm_pu * vn_kv, 5),
            'va_degree': round(float(row['va_degree']), 5),
            'p_mw': round(float(row['p_mw']), 5),
            'q_mvar': round(float(row['q_mvar']), 5)
        }

    lines: Dict[str, Dict[str, float]] = {}
    if len(net.res_line) > 0:
        for line_index, row in net.res_line.iterrows():
            line_name = str(net.line.loc[line_index, 'name'] or f'line-{line_index}')
            lines[line_name] = {
                'loading_percent': round(float(row['loading_percent']), 5),
                'i_from_ka': round(float(row['i_from_ka']), 5),
                'i_to_ka': round(float(row['i_to_ka']), 5),
                'p_from_mw': round(float(row['p_from_mw']), 5),
                'p_to_mw': round(float(row['p_to_mw']), 5),
                'q_from_mvar': round(float(row['q_from_mvar']), 5),
                'q_to_mvar': round(float(row['q_to_mvar']), 5),
                'from_bus_id': index_to_bus_id.get(int(net.line.loc[line_index, 'from_bus']), ''),
                'to_bus_id': index_to_bus_id.get(int(net.line.loc[line_index, 'to_bus']), '')
            }

    def calc_current_ka(p_mw: float, q_mvar: float, voltage_kv: float) -> float:
        if voltage_kv <= 0:
            return 0.0
        apparent_mva = (p_mw**2 + q_mvar**2) ** 0.5
        return apparent_mva / ((3**0.5) * voltage_kv)

    loads: Dict[str, Dict[str, float]] = {}
    if len(net.res_load) > 0:
        for load_index, row in net.res_load.iterrows():
            load_id = str(net.load.loc[load_index, 'name'])
            load_bus_index = int(net.load.loc[load_index, 'bus'])
            load_bus_id = index_to_bus_id.get(load_bus_index, '')
            voltage_kv = buses.get(load_bus_id, {}).get('vm_kv', float(net.bus.loc[load_bus_index, 'vn_kv']))
            p_mw = float(row['p_mw'])
            q_mvar = float(row['q_mvar'])
            loads[load_id] = {
                'bus_id': load_bus_id,
                'p_mw': round(p_mw, 5),
                'q_mvar': round(q_mvar, 5),
                'voltage_kv': round(float(voltage_kv), 5),
                'current_ka': round(calc_current_ka(p_mw, q_mvar, float(voltage_kv)), 5)
            }

    generators: Dict[str, Dict[str, float]] = {}

    if len(net.res_gen) > 0:
        for gen_index, row in net.res_gen.iterrows():
            generator_id = str(net.gen.loc[gen_index, 'name'])
            generator_bus_index = int(net.gen.loc[gen_index, 'bus'])
            generator_bus_id = index_to_bus_id.get(generator_bus_index, '')
            voltage_kv = buses.get(generator_bus_id, {}).get(
                'vm_kv', float(net.bus.loc[generator_bus_index, 'vn_kv'])
            )
            p_mw = float(row['p_mw'])
            q_mvar = float(row['q_mvar'])
            generators[generator_id] = {
                'bus_id': generator_bus_id,
                'p_mw': round(p_mw, 5),
                'q_mvar': round(q_mvar, 5),
                'voltage_kv': round(float(voltage_kv), 5),
                'current_ka': round(calc_current_ka(p_mw, q_mvar, float(voltage_kv)), 5)
            }

    if len(net.res_ext_grid) > 0:
        for ext_grid_index, row in net.res_ext_grid.iterrows():
            generator_id = str(net.ext_grid.loc[ext_grid_index, 'name'])
            generator_bus_index = int(net.ext_grid.loc[ext_grid_index, 'bus'])
            generator_bus_id = index_to_bus_id.get(generator_bus_index, '')
            voltage_kv = buses.get(generator_bus_id, {}).get(
                'vm_kv', float(net.bus.loc[generator_bus_index, 'vn_kv'])
            )
            p_mw = float(row['p_mw'])
            q_mvar = float(row['q_mvar'])
            generators[generator_id] = {
                'bus_id': generator_bus_id,
                'p_mw': round(p_mw, 5),
                'q_mvar': round(q_mvar, 5),
                'voltage_kv': round(float(voltage_kv), 5),
                'current_ka': round(calc_current_ka(p_mw, q_mvar, float(voltage_kv)), 5)
            }

    return {'buses': buses, 'lines': lines, 'loads': loads, 'generators': generators}


@app.post('/api/calculate/short-circuit')
def calculate_short_circuit(payload: ShortCircuitInput):
    if sc is None:
        raise HTTPException(status_code=503, detail='pandapower short-circuit module unavailable.')

    net, bus_map = build_network(payload)

    if payload.fault_bus_id not in bus_map:
        raise HTTPException(status_code=400, detail=f'Invalid fault bus reference: {payload.fault_bus_id}')

    fault_map = {
        'three_phase': '3ph',
        'single_phase': '2ph',
        'earth_fault': '1ph'
    }
    fault_code = fault_map[payload.fault_type]
    fault_bus_idx = bus_map[payload.fault_bus_id]

    try:
        sc.calc_sc(net, case='max', bus=fault_bus_idx, fault=fault_code)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Short circuit failed: {exc}') from exc

    if fault_bus_idx not in net.res_bus_sc.index:
        raise HTTPException(status_code=400, detail='Short circuit results not available for selected fault bus.')

    bus_result = net.res_bus_sc.loc[fault_bus_idx]

    return {
        'fault': {
            'bus_id': payload.fault_bus_id,
            'fault_type': payload.fault_type
        },
        'fault_bus': {
            'current_ka': round(float(bus_result['ikss_ka']), 5),
            'voltage_level_kv': round(float(net.bus.loc[fault_bus_idx, 'vn_kv']), 5)
        },
        'buses': net.res_bus_sc[['ikss_ka', 'skss_mw']].round(5).to_dict('index')
        if len(net.res_bus_sc) > 0
        else {}
    }

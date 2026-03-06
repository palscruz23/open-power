import math
import inspect
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
    load_type: Literal['motor', 'static'] = 'static'


class Generator(BaseModel):
    id: str
    bus: str
    p_mw: float
    vm_pu: float = 1.0


class Transformer(BaseModel):
    id: str
    hv_bus: str
    lv_bus: str
    sn_mva: float = Field(gt=0)
    vn_hv_kv: float = Field(gt=0)
    vn_lv_kv: float = Field(gt=0)
    vk_percent: float = Field(gt=0)
    vkr_percent: float = Field(gt=0)
    vector_group: str | None = None
    shift_degree: float = 0.0


class NetworkInput(BaseModel):
    buses: List[Bus]
    lines: List[Line] = []
    transformers: List[Transformer] = []
    loads: List[Load] = []
    generators: List[Generator] = []


class ShortCircuitInput(NetworkInput):
    fault_bus_id: str
    fault_type: Literal['three_phase', 'single_phase', 'earth_fault'] = 'three_phase'
    current_type: Literal['initial_symmetrical', 'peak', 'thermal_equivalent'] = 'initial_symmetrical'


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


def build_network(payload: NetworkInput, use_motor_elements: bool = False):
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

    create_trafo_sig = inspect.signature(pp.create_transformer_from_parameters)
    for transformer in payload.transformers:
        if transformer.hv_bus not in bus_map or transformer.lv_bus not in bus_map:
            raise HTTPException(status_code=400, detail=f'Invalid transformer bus reference: {transformer.id}')

        if transformer.hv_bus == transformer.lv_bus:
            raise HTTPException(
                status_code=400,
                detail=f'Transformer {transformer.id} must connect two distinct buses.'
            )

        trafo_kwargs = {
            'hv_bus': bus_map[transformer.hv_bus],
            'lv_bus': bus_map[transformer.lv_bus],
            'sn_mva': transformer.sn_mva,
            'vn_hv_kv': transformer.vn_hv_kv,
            'vn_lv_kv': transformer.vn_lv_kv,
            'vk_percent': transformer.vk_percent,
            'vkr_percent': transformer.vkr_percent,
            'pfe_kw': 0.0,
            'i0_percent': 0.0,
            'shift_degree': transformer.shift_degree,
            'name': transformer.id
        }

        if 'vector_group' in create_trafo_sig.parameters and transformer.vector_group:
            trafo_kwargs['vector_group'] = transformer.vector_group

        pp.create_transformer_from_parameters(net, **trafo_kwargs)

    for load in payload.loads:
        if load.bus not in bus_map:
            raise HTTPException(status_code=400, detail=f'Invalid load bus reference: {load.id}')
        if use_motor_elements and load.load_type == 'motor':
            apparent_mva = (float(load.p_mw) ** 2 + float(load.q_mvar) ** 2) ** 0.5
            cos_phi = float(load.p_mw) / apparent_mva if apparent_mva > 0 else 0.9
            cos_phi = max(0.01, min(1.0, cos_phi))
            bus_vn_kv = float(net.bus.loc[bus_map[load.bus], 'vn_kv'])
            pp.create_motor(
                net,
                bus=bus_map[load.bus],
                pn_mech_mw=max(float(load.p_mw), 0.001),
                cos_phi=cos_phi,
                vn_kv=bus_vn_kv,
                lrc_pu=6.0,
                rx=0.42,
                efficiency_percent=95.0,
                efficiency_n_percent=95.0,
                cos_phi_n=cos_phi,
                loading_percent=100.0,
                name=load.id
            )
        else:
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
    net, bus_map = build_network(payload, use_motor_elements=False)

    try:
        pp.runpp(net, max_iteration=500)
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

    if len(net.res_trafo) > 0:
        for trafo_index, row in net.res_trafo.iterrows():
            trafo_name = str(net.trafo.loc[trafo_index, 'name'] or f'trafo-{trafo_index}')
            result_key = f'line-{trafo_name}'
            hv_bus_idx = int(net.trafo.loc[trafo_index, 'hv_bus'])
            lv_bus_idx = int(net.trafo.loc[trafo_index, 'lv_bus'])
            lines[result_key] = {
                'loading_percent': round(float(row['loading_percent']), 5),
                'i_from_ka': round(float(row['i_hv_ka']), 5),
                'i_to_ka': round(float(row['i_lv_ka']), 5),
                'p_from_mw': round(float(row['p_hv_mw']), 5),
                'p_to_mw': round(float(row['p_lv_mw']), 5),
                'q_from_mvar': round(float(row['q_hv_mvar']), 5),
                'q_to_mvar': round(float(row['q_lv_mvar']), 5),
                'from_bus_id': index_to_bus_id.get(hv_bus_idx, ''),
                'to_bus_id': index_to_bus_id.get(lv_bus_idx, '')
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

    net, bus_map = build_network(payload, use_motor_elements=True)

    if payload.fault_bus_id not in bus_map:
        raise HTTPException(status_code=400, detail=f'Invalid fault bus reference: {payload.fault_bus_id}')

    fault_map = {
        'three_phase': '3ph',
        'single_phase': '2ph',
        'earth_fault': '1ph'
    }
    fault_code = fault_map[payload.fault_type]
    fault_bus_idx = bus_map[payload.fault_bus_id]
    current_type_config = {
        'initial_symmetrical': {
            'bus_candidates': ['ikss_ka'],
            'from_candidates': ['ikss_from_ka', 'ikss_ka', 'ikss_ka_from'],
            'to_candidates': ['ikss_to_ka', 'ikss_ka_to', 'ikss_ka'],
            'mid_candidates': ['ikss_ka'],
            'result_key': 'ikss_ka',
            'label': 'Initial symmetrical current'
        },
        'peak': {
            'bus_candidates': ['ip_ka', 'ikss_ka'],
            'from_candidates': ['ip_from_ka', 'ip_ka_from', 'ip_ka', 'ikss_from_ka', 'ikss_ka'],
            'to_candidates': ['ip_to_ka', 'ip_ka_to', 'ip_ka', 'ikss_to_ka', 'ikss_ka'],
            'mid_candidates': ['ip_ka', 'ikss_ka'],
            'result_key': 'ip_ka',
            'label': 'Peak short-circuit current'
        },
        'thermal_equivalent': {
            'bus_candidates': ['ith_ka', 'ikss_ka'],
            'from_candidates': ['ith_from_ka', 'ith_ka_from', 'ith_ka', 'ikss_from_ka', 'ikss_ka'],
            'to_candidates': ['ith_to_ka', 'ith_ka_to', 'ith_ka', 'ikss_to_ka', 'ikss_ka'],
            'mid_candidates': ['ith_ka', 'ikss_ka'],
            'result_key': 'ith_ka',
            'label': 'Thermal equivalent current'
        }
    }
    selected_current_cfg = current_type_config[payload.current_type]

    try:
        sc.calc_sc(net, case='max', bus=fault_bus_idx, fault=fault_code, branch_results=True, ip=True, ith=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Short circuit failed: {exc}') from exc

    if fault_bus_idx not in net.res_bus_sc.index:
        raise HTTPException(status_code=400, detail='Short circuit results not available for selected fault bus.')

    bus_result = net.res_bus_sc.loc[fault_bus_idx]
    index_to_bus_id = {index: bus_id for bus_id, index in bus_map.items()}

    def read_float(row, candidates):
        for column in candidates:
            if column in row:
                value = row[column]
                if value is None:
                    continue
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    continue
                if math.isfinite(numeric):
                    return numeric
        return None

    branches: Dict[str, Dict[str, float | str | None]] = {}
    if hasattr(net, 'res_line_sc') and len(net.res_line_sc) > 0:
        for line_index, row in net.res_line_sc.iterrows():
            line_name = str(net.line.loc[line_index, 'name'] or f'line-{line_index}')
            from_bus_idx = int(net.line.loc[line_index, 'from_bus'])
            to_bus_idx = int(net.line.loc[line_index, 'to_bus'])

            current_from = read_float(row, selected_current_cfg['from_candidates'])
            current_to = read_float(row, selected_current_cfg['to_candidates'])
            current_mid = read_float(row, selected_current_cfg['mid_candidates'])

            candidates = [
                abs(current)
                for current in [current_from, current_to, current_mid]
                if current is not None and math.isfinite(current)
            ]
            contribution_ka = max(candidates) if candidates else 0.0

            branches[line_name] = {
                'from_bus_id': index_to_bus_id.get(from_bus_idx, ''),
                'to_bus_id': index_to_bus_id.get(to_bus_idx, ''),
                'from_current_ka': round(float(current_from), 5) if current_from is not None else None,
                'to_current_ka': round(float(current_to), 5) if current_to is not None else None,
                'current_ka': round(float(current_mid), 5) if current_mid is not None else None,
                'from_ikss_ka': round(float(current_from), 5) if current_from is not None else None,
                'to_ikss_ka': round(float(current_to), 5) if current_to is not None else None,
                'ikss_ka': round(float(current_mid), 5) if current_mid is not None else None,
                'contribution_ka': round(float(contribution_ka), 5)
            }

    if hasattr(net, 'res_trafo_sc') and len(net.res_trafo_sc) > 0:
        trafo_candidates = {
            'initial_symmetrical': {
                'hv_candidates': ['ikss_hv_ka', 'ikss_ka_hv', 'ikss_ka'],
                'lv_candidates': ['ikss_lv_ka', 'ikss_ka_lv', 'ikss_ka'],
                'mid_candidates': ['ikss_ka']
            },
            'peak': {
                'hv_candidates': ['ip_hv_ka', 'ip_ka_hv', 'ip_ka', 'ikss_hv_ka', 'ikss_ka'],
                'lv_candidates': ['ip_lv_ka', 'ip_ka_lv', 'ip_ka', 'ikss_lv_ka', 'ikss_ka'],
                'mid_candidates': ['ip_ka', 'ikss_ka']
            },
            'thermal_equivalent': {
                'hv_candidates': ['ith_hv_ka', 'ith_ka_hv', 'ith_ka', 'ikss_hv_ka', 'ikss_ka'],
                'lv_candidates': ['ith_lv_ka', 'ith_ka_lv', 'ith_ka', 'ikss_lv_ka', 'ikss_ka'],
                'mid_candidates': ['ith_ka', 'ikss_ka']
            }
        }
        selected_trafo_cfg = trafo_candidates[payload.current_type]

        for trafo_index, row in net.res_trafo_sc.iterrows():
            trafo_name = str(net.trafo.loc[trafo_index, 'name'] or f'trafo-{trafo_index}')
            result_key = f'line-{trafo_name}'
            hv_bus_idx = int(net.trafo.loc[trafo_index, 'hv_bus'])
            lv_bus_idx = int(net.trafo.loc[trafo_index, 'lv_bus'])

            current_from = read_float(row, selected_trafo_cfg['hv_candidates'])
            current_to = read_float(row, selected_trafo_cfg['lv_candidates'])
            current_mid = read_float(row, selected_trafo_cfg['mid_candidates'])

            candidates = [
                abs(current)
                for current in [current_from, current_to, current_mid]
                if current is not None and math.isfinite(current)
            ]
            contribution_ka = max(candidates) if candidates else 0.0

            branches[result_key] = {
                'from_bus_id': index_to_bus_id.get(hv_bus_idx, ''),
                'to_bus_id': index_to_bus_id.get(lv_bus_idx, ''),
                'from_current_ka': round(float(current_from), 5) if current_from is not None else None,
                'to_current_ka': round(float(current_to), 5) if current_to is not None else None,
                'current_ka': round(float(current_mid), 5) if current_mid is not None else None,
                'from_ikss_ka': round(float(current_from), 5) if current_from is not None else None,
                'to_ikss_ka': round(float(current_to), 5) if current_to is not None else None,
                'ikss_ka': round(float(current_mid), 5) if current_mid is not None else None,
                'contribution_ka': round(float(contribution_ka), 5)
            }

    fault_bus_current = read_float(bus_result, selected_current_cfg['bus_candidates'])
    if fault_bus_current is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Short circuit result "{selected_current_cfg["label"]}" is not available '
                'for the selected fault case.'
            )
        )

    bus_columns = [column for column in ['ikss_ka', 'ip_ka', 'ith_ka', 'skss_mw'] if column in net.res_bus_sc.columns]
    motor_contributions: Dict[str, Dict[str, float | str]] = {}
    for load in payload.loads:
        if load.load_type != 'motor':
            continue
        bus_idx = bus_map.get(load.bus)
        if bus_idx is None:
            continue
        voltage_kv = float(net.bus.loc[bus_idx, 'vn_kv'])
        if voltage_kv <= 0:
            continue
        apparent_mva = (float(load.p_mw) ** 2 + float(load.q_mvar) ** 2) ** 0.5
        if apparent_mva <= 0:
            continue
        i_nom_ka = apparent_mva / ((3**0.5) * voltage_kv)
        i_sc_ka = 6.0 * i_nom_ka
        motor_contributions[load.id] = {
            'bus_id': load.bus,
            'current_ka': round(float(i_sc_ka), 5),
            'method': 'estimated_lrc_6x'
        }

    return {
        'fault': {
            'bus_id': payload.fault_bus_id,
            'fault_type': payload.fault_type,
            'current_type': payload.current_type,
            'current_type_label': selected_current_cfg['label'],
            'current_result_key': selected_current_cfg['result_key']
        },
        'fault_bus': {
            'current_ka': round(float(fault_bus_current), 5),
            'voltage_level_kv': round(float(net.bus.loc[fault_bus_idx, 'vn_kv']), 5)
        },
        'branches': branches,
        'motor_contributions': motor_contributions,
        'buses': net.res_bus_sc[bus_columns].round(5).to_dict('index')
        if len(net.res_bus_sc) > 0
        else {}
    }

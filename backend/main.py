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


class ProtectionSettings(BaseModel):
    phase_mode: Literal['phase', 'ground'] = 'phase'
    curve_family: str | None = None
    pickup_current_a: float | None = None
    time_dial: float | None = None
    instantaneous_pickup_a: float | None = None
    clearing_time_adder_s: float = 0.0


class ProtectionDevice(BaseModel):
    asset_id: str
    asset_type: Literal['load', 'resistive_load', 'generator', 'utility', 'transformer']
    device_type: Literal['oc_relay', 'recloser', 'fuse'] = 'oc_relay'
    name: str | None = None
    settings: ProtectionSettings = Field(default_factory=ProtectionSettings)


class SharedNetworkInput(BaseModel):
    buses: List[Bus]
    lines: List[Line] = Field(default_factory=list)
    transformers: List[Transformer] = Field(default_factory=list)
    loads: List[Load] = Field(default_factory=list)
    generators: List[Generator] = Field(default_factory=list)
    protection_devices: List[ProtectionDevice] = Field(default_factory=list)


class LoadFlowInput(SharedNetworkInput):
    pass


class ShortCircuitInput(SharedNetworkInput):
    standard: Literal['ansi', 'iec_60909'] = 'ansi'
    fault_bus_id: str
    fault_type: Literal['three_phase', 'single_phase', 'earth_fault'] = 'three_phase'
    current_type: Literal['initial_symmetrical', 'peak', 'thermal_equivalent'] = 'initial_symmetrical'


class ProtectionStudyInput(SharedNetworkInput):
    coordination_margin_s: float = Field(default=0.3, ge=0)


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


def build_network(payload: SharedNetworkInput, use_motor_elements: bool = False):
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


def get_short_circuit_standard_config(payload: ShortCircuitInput) -> Dict[str, object]:
    if payload.standard == 'ansi':
        if payload.fault_type != 'three_phase':
            raise HTTPException(
                status_code=400,
                detail=(
                    'ANSI short-circuit mode currently supports only three-phase faults. '
                    'Single-phase and earth-fault ANSI cases are not implemented in this release.'
                )
            )
        if payload.current_type == 'thermal_equivalent':
            raise HTTPException(
                status_code=400,
                detail=(
                    'ANSI short-circuit mode does not provide thermal equivalent current in this release. '
                    'Use initial symmetrical or peak current instead.'
                )
            )

        return {
            'standard_label': 'ANSI',
            'engine_note': (
                'Calculated with pandapower short-circuit max-case results and presented with ANSI-oriented labels.'
            ),
            'limitations': [
                'ANSI mode currently supports only three-phase faults.',
                'ANSI thermal equivalent current is not available in this release.'
            ],
            'current_types': {
                'initial_symmetrical': {
                    'bus_candidates': ['ikss_ka'],
                    'from_candidates': ['ikss_from_ka', 'ikss_ka', 'ikss_ka_from'],
                    'to_candidates': ['ikss_to_ka', 'ikss_ka_to', 'ikss_ka'],
                    'mid_candidates': ['ikss_ka'],
                    'trafo_from_candidates': ['ikss_hv_ka', 'ikss_ka_hv', 'ikss_ka'],
                    'trafo_to_candidates': ['ikss_lv_ka', 'ikss_ka_lv', 'ikss_ka'],
                    'trafo_mid_candidates': ['ikss_ka'],
                    'result_key': 'ikss_ka',
                    'branch_from_result_key': 'from_ikss_ka',
                    'branch_to_result_key': 'to_ikss_ka',
                    'branch_result_key': 'ikss_ka',
                    'label': 'ANSI symmetrical RMS current'
                },
                'peak': {
                    'bus_candidates': ['ip_ka', 'ikss_ka'],
                    'from_candidates': ['ip_from_ka', 'ip_ka_from', 'ip_ka', 'ikss_from_ka', 'ikss_ka'],
                    'to_candidates': ['ip_to_ka', 'ip_ka_to', 'ip_ka', 'ikss_to_ka', 'ikss_ka'],
                    'mid_candidates': ['ip_ka', 'ikss_ka'],
                    'trafo_from_candidates': ['ip_hv_ka', 'ip_ka_hv', 'ip_ka', 'ikss_hv_ka', 'ikss_ka'],
                    'trafo_to_candidates': ['ip_lv_ka', 'ip_ka_lv', 'ip_ka', 'ikss_lv_ka', 'ikss_ka'],
                    'trafo_mid_candidates': ['ip_ka', 'ikss_ka'],
                    'result_key': 'ip_ka',
                    'branch_from_result_key': 'from_ip_ka',
                    'branch_to_result_key': 'to_ip_ka',
                    'branch_result_key': 'ip_ka',
                    'label': 'ANSI peak making current'
                }
            }
        }

    return {
        'standard_label': 'IEC 60909',
        'engine_note': 'Calculated with pandapower IEC 60909 short-circuit results.',
        'limitations': [],
        'current_types': {
            'initial_symmetrical': {
                'bus_candidates': ['ikss_ka'],
                'from_candidates': ['ikss_from_ka', 'ikss_ka', 'ikss_ka_from'],
                'to_candidates': ['ikss_to_ka', 'ikss_ka_to', 'ikss_ka'],
                'mid_candidates': ['ikss_ka'],
                'trafo_from_candidates': ['ikss_hv_ka', 'ikss_ka_hv', 'ikss_ka'],
                'trafo_to_candidates': ['ikss_lv_ka', 'ikss_ka_lv', 'ikss_ka'],
                'trafo_mid_candidates': ['ikss_ka'],
                'result_key': 'ikss_ka',
                'branch_from_result_key': 'from_ikss_ka',
                'branch_to_result_key': 'to_ikss_ka',
                'branch_result_key': 'ikss_ka',
                'label': 'Initial symmetrical current'
            },
            'peak': {
                'bus_candidates': ['ip_ka', 'ikss_ka'],
                'from_candidates': ['ip_from_ka', 'ip_ka_from', 'ip_ka', 'ikss_from_ka', 'ikss_ka'],
                'to_candidates': ['ip_to_ka', 'ip_ka_to', 'ip_ka', 'ikss_to_ka', 'ikss_ka'],
                'mid_candidates': ['ip_ka', 'ikss_ka'],
                'trafo_from_candidates': ['ip_hv_ka', 'ip_ka_hv', 'ip_ka', 'ikss_hv_ka', 'ikss_ka'],
                'trafo_to_candidates': ['ip_lv_ka', 'ip_ka_lv', 'ip_ka', 'ikss_lv_ka', 'ikss_ka'],
                'trafo_mid_candidates': ['ip_ka', 'ikss_ka'],
                'result_key': 'ip_ka',
                'branch_from_result_key': 'from_ip_ka',
                'branch_to_result_key': 'to_ip_ka',
                'branch_result_key': 'ip_ka',
                'label': 'Peak short-circuit current'
            },
            'thermal_equivalent': {
                'bus_candidates': ['ith_ka', 'ikss_ka'],
                'from_candidates': ['ith_from_ka', 'ith_ka_from', 'ith_ka', 'ikss_from_ka', 'ikss_ka'],
                'to_candidates': ['ith_to_ka', 'ith_ka_to', 'ith_ka', 'ikss_to_ka', 'ikss_ka'],
                'mid_candidates': ['ith_ka', 'ikss_ka'],
                'trafo_from_candidates': ['ith_hv_ka', 'ith_ka_hv', 'ith_ka', 'ikss_hv_ka', 'ikss_ka'],
                'trafo_to_candidates': ['ith_lv_ka', 'ith_ka_lv', 'ith_ka', 'ikss_lv_ka', 'ikss_ka'],
                'trafo_mid_candidates': ['ith_ka', 'ikss_ka'],
                'result_key': 'ith_ka',
                'branch_from_result_key': 'from_ith_ka',
                'branch_to_result_key': 'to_ith_ka',
                'branch_result_key': 'ith_ka',
                'label': 'Thermal equivalent current'
            }
        }
    }


def validate_protection_study(payload: ProtectionStudyInput) -> List[Dict[str, object]]:
    load_ids = {load.id for load in payload.loads}
    generator_ids = {generator.id for generator in payload.generators}
    transformer_ids = {transformer.id for transformer in payload.transformers}
    known_asset_ids = load_ids | generator_ids | transformer_ids

    if not payload.protection_devices:
        raise HTTPException(
            status_code=400,
            detail=(
                'Add at least one protection device before running protection coordination validation.'
            )
        )

    validated_devices: List[Dict[str, object]] = []
    for device in payload.protection_devices:
        if device.asset_id not in known_asset_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" references unsupported asset '
                    f'"{device.asset_id}". Attach devices only to loads, generators, utilities, or transformers.'
                )
            )

        if device.asset_type in {'load', 'resistive_load'} and device.asset_id not in load_ids:
            raise HTTPException(
                status_code=400,
                detail=f'Protection device "{device.name or device.asset_id}" must be attached to a load asset.'
            )
        if device.asset_type in {'generator', 'utility'} and device.asset_id not in generator_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" must be attached to a generator '
                    'or utility source asset.'
                )
            )
        if device.asset_type == 'transformer' and device.asset_id not in transformer_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" must be attached to a transformer asset.'
                )
            )

        settings = device.settings
        missing_fields = []
        curve_family = settings.curve_family.strip() if isinstance(settings.curve_family, str) else ''
        if not curve_family:
            missing_fields.append('curve family')

        pickup_current_a = settings.pickup_current_a
        if pickup_current_a is None or not math.isfinite(pickup_current_a) or pickup_current_a <= 0:
            missing_fields.append('pickup current')

        time_dial = settings.time_dial
        if time_dial is None or not math.isfinite(time_dial) or time_dial <= 0:
            missing_fields.append('time dial')

        instantaneous_pickup_a = settings.instantaneous_pickup_a
        if (
            instantaneous_pickup_a is not None
            and (not math.isfinite(instantaneous_pickup_a) or instantaneous_pickup_a <= 0)
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" has an invalid instantaneous pickup '
                    'current.'
                )
            )

        if not math.isfinite(settings.clearing_time_adder_s) or settings.clearing_time_adder_s < 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" has an invalid clearing time adder.'
                )
            )

        if missing_fields:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" is missing required settings: '
                    f'{", ".join(missing_fields)}.'
                )
            )

        validated_devices.append(
            {
                'asset_id': device.asset_id,
                'asset_type': device.asset_type,
                'device_type': device.device_type,
                'name': device.name or device.asset_id,
                'phase_mode': settings.phase_mode,
                'curve_family': curve_family,
                'pickup_current_a': round(float(pickup_current_a), 5),
                'time_dial': round(float(time_dial), 5),
                'instantaneous_pickup_a': (
                    round(float(instantaneous_pickup_a), 5)
                    if instantaneous_pickup_a is not None
                    else None
                ),
                'clearing_time_adder_s': round(float(settings.clearing_time_adder_s), 5)
            }
        )

    return validated_devices


PROTECTION_CURVE_LIBRARY = {
    'iec_standard_inverse': {
        'label': 'IEC Standard Inverse',
        'standard': 'IEC 60255'
    },
    'iec_very_inverse': {
        'label': 'IEC Very Inverse',
        'standard': 'IEC 60255'
    },
    'ansi_moderately_inverse': {
        'label': 'ANSI Moderately Inverse',
        'standard': 'ANSI/IEEE'
    },
    'ansi_very_inverse': {
        'label': 'ANSI Very Inverse',
        'standard': 'ANSI/IEEE'
    },
    'ansi_k': {
        'label': 'ANSI K Fuse',
        'standard': 'ANSI/IEEE'
    }
}


def evaluate_protection_operating_time(curve_family: str, multiple: float, time_dial: float) -> float:
    if multiple <= 1.0:
        raise ValueError('Protection curve multiple must be greater than 1.0.')

    if curve_family == 'iec_standard_inverse':
        return time_dial * (0.14 / ((multiple**0.02) - 1.0))
    if curve_family == 'iec_very_inverse':
        return time_dial * (13.5 / (multiple - 1.0))
    if curve_family == 'ansi_moderately_inverse':
        return time_dial * ((0.0515 / ((multiple**0.02) - 1.0)) + 0.114)
    if curve_family == 'ansi_very_inverse':
        return time_dial * ((19.61 / ((multiple**2.0) - 1.0)) + 0.491)
    if curve_family == 'ansi_k':
        return time_dial * (5.95 / ((multiple**2.0) - 1.0))

    raise HTTPException(
        status_code=400,
        detail=f'Protection curve family "{curve_family}" is not supported in this release.'
    )


def build_protection_load_flow_context(payload: ProtectionStudyInput) -> Dict[str, Dict[str, float]]:
    net, bus_map = build_network(payload, use_motor_elements=False)
    index_to_bus_id = {index: bus_id for bus_id, index in bus_map.items()}

    try:
        pp.runpp(net, max_iteration=500)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                'Protection coordination requires a solvable load-flow base case. '
                f'Load flow failed: {exc}'
            )
        ) from exc

    bus_voltage_kv = {
        index_to_bus_id[bus_index]: round(float(row['vm_pu']) * float(net.bus.loc[bus_index, 'vn_kv']), 5)
        for bus_index, row in net.res_bus.iterrows()
        if bus_index in index_to_bus_id
    }

    load_current_a: Dict[str, float] = {}
    if len(net.res_load) > 0:
        for load_index, row in net.res_load.iterrows():
            load_id = str(net.load.loc[load_index, 'name'])
            bus_index = int(net.load.loc[load_index, 'bus'])
            voltage_kv = bus_voltage_kv.get(index_to_bus_id.get(bus_index, ''), float(net.bus.loc[bus_index, 'vn_kv']))
            if voltage_kv <= 0:
                load_current_a[load_id] = 0.0
                continue
            p_mw = float(row['p_mw'])
            q_mvar = float(row['q_mvar'])
            apparent_mva = (p_mw**2 + q_mvar**2) ** 0.5
            load_current_a[load_id] = round((apparent_mva / ((3**0.5) * voltage_kv)) * 1000.0, 5)

    generator_current_a: Dict[str, float] = {}
    if len(net.res_gen) > 0:
        for gen_index, row in net.res_gen.iterrows():
            generator_id = str(net.gen.loc[gen_index, 'name'])
            bus_index = int(net.gen.loc[gen_index, 'bus'])
            voltage_kv = bus_voltage_kv.get(index_to_bus_id.get(bus_index, ''), float(net.bus.loc[bus_index, 'vn_kv']))
            if voltage_kv <= 0:
                generator_current_a[generator_id] = 0.0
                continue
            p_mw = float(row['p_mw'])
            q_mvar = float(row['q_mvar'])
            apparent_mva = (p_mw**2 + q_mvar**2) ** 0.5
            generator_current_a[generator_id] = round((apparent_mva / ((3**0.5) * voltage_kv)) * 1000.0, 5)

    if len(net.res_ext_grid) > 0:
        for ext_grid_index, row in net.res_ext_grid.iterrows():
            generator_id = str(net.ext_grid.loc[ext_grid_index, 'name'])
            bus_index = int(net.ext_grid.loc[ext_grid_index, 'bus'])
            voltage_kv = bus_voltage_kv.get(index_to_bus_id.get(bus_index, ''), float(net.bus.loc[bus_index, 'vn_kv']))
            if voltage_kv <= 0:
                generator_current_a[generator_id] = 0.0
                continue
            p_mw = float(row['p_mw'])
            q_mvar = float(row['q_mvar'])
            apparent_mva = (p_mw**2 + q_mvar**2) ** 0.5
            generator_current_a[generator_id] = round((apparent_mva / ((3**0.5) * voltage_kv)) * 1000.0, 5)

    transformer_current_a: Dict[str, Dict[str, float]] = {}
    if len(net.res_trafo) > 0:
        for trafo_index, row in net.res_trafo.iterrows():
            transformer_id = str(net.trafo.loc[trafo_index, 'name'])
            transformer_current_a[transformer_id] = {
                'hv_current_a': round(float(row['i_hv_ka']) * 1000.0, 5),
                'lv_current_a': round(float(row['i_lv_ka']) * 1000.0, 5)
            }

    return {
        'bus_voltage_kv': bus_voltage_kv,
        'load_current_a': load_current_a,
        'generator_current_a': generator_current_a,
        'transformer_current_a': transformer_current_a
    }


def calculate_bus_fault_current_a(payload: ProtectionStudyInput, bus_id: str) -> float:
    if sc is None:
        raise HTTPException(status_code=503, detail='pandapower short-circuit module unavailable.')

    net, bus_map = build_network(payload, use_motor_elements=True)
    if bus_id not in bus_map:
        raise HTTPException(
            status_code=400,
            detail=f'Protection coordination device references unknown bus "{bus_id}".'
        )

    try:
        sc.calc_sc(net, case='max', bus=bus_map[bus_id], fault='3ph', branch_results=False, ip=True, ith=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection coordination could not calculate fault current at bus "{bus_id}". '
                f'Check source and impedance data. Short circuit failed: {exc}'
            )
        ) from exc

    if bus_map[bus_id] not in net.res_bus_sc.index:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection coordination did not return a fault current for bus "{bus_id}". '
                'Check that the protected asset is connected to an energized bus.'
            )
        )

    current_ka = net.res_bus_sc.loc[bus_map[bus_id]].get('ikss_ka')
    if current_ka is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection coordination did not return an initial symmetrical current for bus "{bus_id}". '
                'Check that the protected asset is connected to an energized bus.'
            )
        )

    current_a = float(current_ka) * 1000.0
    if not math.isfinite(current_a) or current_a <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection coordination found no usable fault current at bus "{bus_id}". '
                'Check source connection and device placement.'
            )
        )

    return round(current_a, 5)


def build_protection_asset_context(
    payload: ProtectionStudyInput,
    validated_device: Dict[str, object],
    load_flow_context: Dict[str, Dict[str, float]]
) -> Dict[str, object]:
    load_by_id = {load.id: load for load in payload.loads}
    generator_by_id = {generator.id: generator for generator in payload.generators}
    transformer_by_id = {transformer.id: transformer for transformer in payload.transformers}
    bus_voltage_kv = load_flow_context['bus_voltage_kv']

    asset_id = str(validated_device['asset_id'])
    asset_type = str(validated_device['asset_type'])
    pickup_current_a = float(validated_device['pickup_current_a'])

    if asset_type in {'load', 'resistive_load'}:
        load = load_by_id[asset_id]
        return {
            'bus_id': load.bus,
            'bus_role': 'load_bus',
            'bus_voltage_kv': bus_voltage_kv.get(load.bus, 0.0),
            'load_current_a': float(load_flow_context['load_current_a'].get(asset_id, 0.0))
        }

    if asset_type in {'generator', 'utility'}:
        generator = generator_by_id[asset_id]
        return {
            'bus_id': generator.bus,
            'bus_role': 'source_bus',
            'bus_voltage_kv': bus_voltage_kv.get(generator.bus, 0.0),
            'load_current_a': float(load_flow_context['generator_current_a'].get(asset_id, 0.0))
        }

    if asset_type == 'transformer':
        transformer = transformer_by_id[asset_id]
        hv_current_a = (transformer.sn_mva * 1000.0) / ((3**0.5) * transformer.vn_hv_kv)
        lv_current_a = (transformer.sn_mva * 1000.0) / ((3**0.5) * transformer.vn_lv_kv)
        hv_error = abs(hv_current_a - pickup_current_a)
        lv_error = abs(lv_current_a - pickup_current_a)
        use_hv_side = hv_error <= lv_error
        result_currents = load_flow_context['transformer_current_a'].get(asset_id, {})
        return {
            'bus_id': transformer.hv_bus if use_hv_side else transformer.lv_bus,
            'bus_role': 'transformer_hv_bus' if use_hv_side else 'transformer_lv_bus',
            'bus_voltage_kv': bus_voltage_kv.get(transformer.hv_bus if use_hv_side else transformer.lv_bus, 0.0),
            'load_current_a': float(
                result_currents.get('hv_current_a' if use_hv_side else 'lv_current_a', 0.0)
            )
        }

    raise HTTPException(
        status_code=400,
        detail=f'Protection device "{validated_device["name"]}" has unsupported asset type "{asset_type}".'
    )


def generate_protection_curve_points(
    validated_device: Dict[str, object],
    load_current_a: float,
    max_fault_current_a: float
) -> List[Dict[str, object]]:
    pickup_current_a = float(validated_device['pickup_current_a'])
    time_dial = float(validated_device['time_dial'])
    clearing_time_adder_s = float(validated_device['clearing_time_adder_s'])
    instantaneous_pickup_a = validated_device.get('instantaneous_pickup_a')
    instantaneous_pickup_a = float(instantaneous_pickup_a) if instantaneous_pickup_a is not None else None

    if max_fault_current_a <= pickup_current_a:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection device "{validated_device["name"]}" has pickup current {round(pickup_current_a, 3)} A '
                f'but only {round(max_fault_current_a, 3)} A of available three-phase fault current at its bus. '
                'Lower the pickup or increase available source fault level before running coordination.'
            )
        )

    inverse_region_floor_a = max(pickup_current_a * 1.05, min(max(load_current_a * 1.25, pickup_current_a * 1.05), max_fault_current_a))
    inverse_region_ceiling_a = max_fault_current_a
    if instantaneous_pickup_a is not None:
        inverse_region_ceiling_a = min(inverse_region_ceiling_a, instantaneous_pickup_a * 0.98)

    points: List[Dict[str, object]] = []
    if inverse_region_ceiling_a > inverse_region_floor_a:
        point_count = 18
        log_min = math.log10(inverse_region_floor_a)
        log_max = math.log10(inverse_region_ceiling_a)
        for index in range(point_count):
            current_a = 10 ** (log_min + ((log_max - log_min) * index / (point_count - 1)))
            multiple = current_a / pickup_current_a
            if multiple <= 1.0:
                continue
            operating_time_s = evaluate_protection_operating_time(
                str(validated_device['curve_family']),
                multiple,
                time_dial
            ) + clearing_time_adder_s
            points.append(
                {
                    'current_a': round(current_a, 5),
                    'current_ka': round(current_a / 1000.0, 5),
                    'time_s': round(operating_time_s, 5),
                    'region': 'inverse'
                }
            )

    if instantaneous_pickup_a is not None and max_fault_current_a >= instantaneous_pickup_a:
        instantaneous_time_s = clearing_time_adder_s + (0.03 if validated_device['device_type'] == 'fuse' else 0.05)
        points.extend(
            [
                {
                    'current_a': round(instantaneous_pickup_a, 5),
                    'current_ka': round(instantaneous_pickup_a / 1000.0, 5),
                    'time_s': round(instantaneous_time_s, 5),
                    'region': 'instantaneous'
                },
                {
                    'current_a': round(max_fault_current_a, 5),
                    'current_ka': round(max_fault_current_a / 1000.0, 5),
                    'time_s': round(instantaneous_time_s, 5),
                    'region': 'instantaneous'
                }
            ]
        )

    if not points:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection device "{validated_device["name"]}" has no usable current range between pickup '
                'and available fault current for a coordination curve. Check pickup, instantaneous, and source data.'
            )
        )

    return sorted(points, key=lambda point: (point['current_a'], point['time_s']))


def normalize_curve_points_for_analysis(curve: Dict[str, object]) -> List[Dict[str, float]]:
    current_to_time: Dict[float, float] = {}
    for point in curve.get('points', []):
        current_a = point.get('current_a')
        time_s = point.get('time_s')
        try:
            current_value = float(current_a)
            time_value = float(time_s)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(current_value) or not math.isfinite(time_value):
            continue
        if current_value <= 0 or time_value <= 0:
            continue
        existing_time = current_to_time.get(current_value)
        current_to_time[current_value] = min(existing_time, time_value) if existing_time is not None else time_value

    return [
        {'current_a': current_a, 'time_s': current_to_time[current_a]}
        for current_a in sorted(current_to_time.keys())
    ]


def interpolate_curve_time(points: List[Dict[str, float]], current_a: float) -> float | None:
    if len(points) == 0 or current_a <= 0:
        return None

    if current_a < points[0]['current_a'] or current_a > points[-1]['current_a']:
        return None

    for point in points:
        if math.isclose(point['current_a'], current_a, rel_tol=1e-9, abs_tol=1e-9):
            return point['time_s']

    for index in range(len(points) - 1):
        left = points[index]
        right = points[index + 1]
        left_current = left['current_a']
        right_current = right['current_a']
        if left_current >= right_current:
            continue
        if left_current <= current_a <= right_current:
            left_time = left['time_s']
            right_time = right['time_s']
            log_span = math.log10(right_current) - math.log10(left_current)
            if math.isclose(log_span, 0.0, abs_tol=1e-12):
                return min(left_time, right_time)
            position = (math.log10(current_a) - math.log10(left_current)) / log_span
            return 10 ** (math.log10(left_time) + (math.log10(right_time) - math.log10(left_time)) * position)

    return None


def build_coordination_segment_label(curve_a: Dict[str, object], curve_b: Dict[str, object]) -> str:
    bus_a = str(curve_a.get('bus_id') or '?')
    bus_b = str(curve_b.get('bus_id') or '?')
    role_a = str(curve_a.get('bus_role') or 'device')
    role_b = str(curve_b.get('bus_role') or 'device')

    if bus_a == bus_b:
        return f'shared bus {bus_a}'

    return f'{bus_a} ({role_a}) to {bus_b} ({role_b})'


def analyze_protection_coordination(
    curves: List[Dict[str, object]],
    coordination_margin_s: float
) -> Dict[str, object]:
    warnings: List[Dict[str, object]] = []
    rounded_margin_s = round(float(coordination_margin_s), 5)

    for left_index in range(len(curves)):
        left_curve = curves[left_index]
        left_points = normalize_curve_points_for_analysis(left_curve)
        if len(left_points) < 2:
            continue

        for right_index in range(left_index + 1, len(curves)):
            right_curve = curves[right_index]
            right_points = normalize_curve_points_for_analysis(right_curve)
            if len(right_points) < 2:
                continue

            overlap_start_a = max(left_points[0]['current_a'], right_points[0]['current_a'])
            overlap_end_a = min(left_points[-1]['current_a'], right_points[-1]['current_a'])
            if overlap_end_a <= overlap_start_a:
                continue

            sample_currents = {
                overlap_start_a,
                overlap_end_a
            }
            for points in (left_points, right_points):
                for point in points:
                    current_a = point['current_a']
                    if overlap_start_a <= current_a <= overlap_end_a:
                        sample_currents.add(current_a)

            if overlap_start_a > 0 and overlap_end_a > overlap_start_a:
                sample_count = 7
                log_start = math.log10(overlap_start_a)
                log_end = math.log10(overlap_end_a)
                for sample_index in range(sample_count):
                    sample_currents.add(
                        10 ** (log_start + ((log_end - log_start) * sample_index / (sample_count - 1)))
                    )

            evaluated_samples: List[Dict[str, float]] = []
            for current_a in sorted(sample_currents):
                left_time = interpolate_curve_time(left_points, current_a)
                right_time = interpolate_curve_time(right_points, current_a)
                if left_time is None or right_time is None:
                    continue
                evaluated_samples.append(
                    {
                        'current_a': current_a,
                        'left_time_s': left_time,
                        'right_time_s': right_time,
                        'time_gap_s': abs(left_time - right_time),
                        'ordering_sign': left_time - right_time
                    }
                )

            if len(evaluated_samples) < 2:
                continue

            device_names = [str(left_curve.get('device_name') or left_curve.get('asset_id') or 'Device A'),
                            str(right_curve.get('device_name') or right_curve.get('asset_id') or 'Device B')]
            segment_label = build_coordination_segment_label(left_curve, right_curve)
            ordering_warning = None
            minimum_gap_sample = min(evaluated_samples, key=lambda sample: sample['time_gap_s'])

            for sample_index in range(len(evaluated_samples) - 1):
                current_sample = evaluated_samples[sample_index]
                next_sample = evaluated_samples[sample_index + 1]
                current_sign = current_sample['ordering_sign']
                next_sign = next_sample['ordering_sign']
                if math.isclose(current_sign, 0.0, abs_tol=1e-9) or math.isclose(next_sign, 0.0, abs_tol=1e-9):
                    ordering_warning = {
                        'type': 'ordering',
                        'severity': 'warning',
                        'device_names': device_names,
                        'device_ids': [
                            str(left_curve.get('device_id') or left_curve.get('asset_id') or ''),
                            str(right_curve.get('device_id') or right_curve.get('asset_id') or '')
                        ],
                        'segment_label': segment_label,
                        'current_window_a': {
                            'from': round(current_sample['current_a'], 5),
                            'to': round(next_sample['current_a'], 5)
                        },
                        'minimum_time_gap_s': round(min(current_sample['time_gap_s'], next_sample['time_gap_s']), 5),
                        'message': (
                            f'{device_names[0]} and {device_names[1]} change operating order around '
                            f'{segment_label}. Their curves meet or cross between '
                            f'{round(current_sample["current_a"], 3)} A and {round(next_sample["current_a"], 3)} A.'
                        )
                    }
                    break
                if current_sign * next_sign < 0:
                    ordering_warning = {
                        'type': 'ordering',
                        'severity': 'warning',
                        'device_names': device_names,
                        'device_ids': [
                            str(left_curve.get('device_id') or left_curve.get('asset_id') or ''),
                            str(right_curve.get('device_id') or right_curve.get('asset_id') or '')
                        ],
                        'segment_label': segment_label,
                        'current_window_a': {
                            'from': round(current_sample['current_a'], 5),
                            'to': round(next_sample['current_a'], 5)
                        },
                        'minimum_time_gap_s': round(min(current_sample['time_gap_s'], next_sample['time_gap_s']), 5),
                        'message': (
                            f'{device_names[0]} and {device_names[1]} reverse operating order over '
                            f'{segment_label}. Review the crossover between '
                            f'{round(current_sample["current_a"], 3)} A and {round(next_sample["current_a"], 3)} A.'
                        )
                    }
                    break

            if ordering_warning is not None:
                warnings.append(ordering_warning)
                continue

            if minimum_gap_sample['time_gap_s'] < coordination_margin_s:
                warnings.append(
                    {
                        'type': 'overlap',
                        'severity': 'warning',
                        'device_names': device_names,
                        'device_ids': [
                            str(left_curve.get('device_id') or left_curve.get('asset_id') or ''),
                            str(right_curve.get('device_id') or right_curve.get('asset_id') or '')
                        ],
                        'segment_label': segment_label,
                        'current_window_a': {
                            'from': round(overlap_start_a, 5),
                            'to': round(overlap_end_a, 5)
                        },
                        'minimum_time_gap_s': round(minimum_gap_sample['time_gap_s'], 5),
                        'message': (
                            f'{device_names[0]} and {device_names[1]} stay within '
                            f'{rounded_margin_s} s of each other over {segment_label}. '
                            f'The tightest gap is {round(minimum_gap_sample["time_gap_s"], 3)} s near '
                            f'{round(minimum_gap_sample["current_a"], 3)} A.'
                        )
                    }
                )

    return {
        'warning_count': len(warnings),
        'warnings': warnings,
        'scope_notes': [
            'Automatic grading checks in this release are limited to curve overlap and ordering warnings from the generated TCC data.',
            'Advanced coordination checks such as full feeder selectivity, directional elements, fuse damage curves, and CT or relay tolerance studies are out of scope.'
        ]
    }


@app.post('/api/calculate/load-flow')
def calculate_load_flow(payload: LoadFlowInput):
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
    standard_cfg = get_short_circuit_standard_config(payload)

    if payload.fault_bus_id not in bus_map:
        raise HTTPException(status_code=400, detail=f'Invalid fault bus reference: {payload.fault_bus_id}')

    fault_map = {
        'three_phase': '3ph',
        'single_phase': '2ph',
        'earth_fault': '1ph'
    }
    fault_code = fault_map[payload.fault_type]
    fault_bus_idx = bus_map[payload.fault_bus_id]
    current_type_config = standard_cfg['current_types']
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

    def make_branch_result(
        from_bus_id: str,
        to_bus_id: str,
        current_from: float | None,
        current_to: float | None,
        current_mid: float | None
    ) -> Dict[str, float | str | None]:
        candidates = [
            abs(current)
            for current in [current_from, current_to, current_mid]
            if current is not None and math.isfinite(current)
        ]
        contribution_ka = max(candidates) if candidates else 0.0

        result = {
            'from_bus_id': from_bus_id,
            'to_bus_id': to_bus_id,
            'from_current_ka': round(float(current_from), 5) if current_from is not None else None,
            'to_current_ka': round(float(current_to), 5) if current_to is not None else None,
            'current_ka': round(float(current_mid), 5) if current_mid is not None else None,
            'result_key': selected_current_cfg['branch_result_key'],
            'result_label': selected_current_cfg['label'],
            'contribution_ka': round(float(contribution_ka), 5)
        }

        result[selected_current_cfg['branch_from_result_key']] = result['from_current_ka']
        result[selected_current_cfg['branch_to_result_key']] = result['to_current_ka']
        result[selected_current_cfg['branch_result_key']] = result['current_ka']

        if selected_current_cfg['branch_result_key'] != 'ikss_ka':
            result['from_ikss_ka'] = None
            result['to_ikss_ka'] = None
            result['ikss_ka'] = None
        else:
            result['from_ikss_ka'] = result['from_current_ka']
            result['to_ikss_ka'] = result['to_current_ka']
            result['ikss_ka'] = result['current_ka']

        return result

    branches: Dict[str, Dict[str, float | str | None]] = {}
    if hasattr(net, 'res_line_sc') and len(net.res_line_sc) > 0:
        for line_index, row in net.res_line_sc.iterrows():
            line_name = str(net.line.loc[line_index, 'name'] or f'line-{line_index}')
            from_bus_idx = int(net.line.loc[line_index, 'from_bus'])
            to_bus_idx = int(net.line.loc[line_index, 'to_bus'])

            current_from = read_float(row, selected_current_cfg['from_candidates'])
            current_to = read_float(row, selected_current_cfg['to_candidates'])
            current_mid = read_float(row, selected_current_cfg['mid_candidates'])
            branches[line_name] = make_branch_result(
                index_to_bus_id.get(from_bus_idx, ''),
                index_to_bus_id.get(to_bus_idx, ''),
                current_from,
                current_to,
                current_mid
            )

    if hasattr(net, 'res_trafo_sc') and len(net.res_trafo_sc) > 0:
        for trafo_index, row in net.res_trafo_sc.iterrows():
            trafo_name = str(net.trafo.loc[trafo_index, 'name'] or f'trafo-{trafo_index}')
            result_key = f'line-{trafo_name}'
            hv_bus_idx = int(net.trafo.loc[trafo_index, 'hv_bus'])
            lv_bus_idx = int(net.trafo.loc[trafo_index, 'lv_bus'])

            current_from = read_float(row, selected_current_cfg['trafo_from_candidates'])
            current_to = read_float(row, selected_current_cfg['trafo_to_candidates'])
            current_mid = read_float(row, selected_current_cfg['trafo_mid_candidates'])
            branches[result_key] = make_branch_result(
                index_to_bus_id.get(hv_bus_idx, ''),
                index_to_bus_id.get(lv_bus_idx, ''),
                current_from,
                current_to,
                current_mid
            )

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
            'standard': payload.standard,
            'standard_label': standard_cfg['standard_label'],
            'fault_type': payload.fault_type,
            'current_type': payload.current_type,
            'current_type_label': selected_current_cfg['label'],
            'current_result_key': selected_current_cfg['result_key'],
            'engine_note': standard_cfg['engine_note'],
            'limitations': standard_cfg['limitations']
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


@app.post('/api/calculate/protection-coordination')
def calculate_protection_coordination(payload: ProtectionStudyInput):
    validated_devices = validate_protection_study(payload)
    load_flow_context = build_protection_load_flow_context(payload)
    fault_current_cache: Dict[str, float] = {}
    devices: List[Dict[str, object]] = []
    curves: List[Dict[str, object]] = []

    for validated_device in validated_devices:
        asset_context = build_protection_asset_context(payload, validated_device, load_flow_context)
        bus_id = str(asset_context['bus_id'])
        if bus_id not in fault_current_cache:
            fault_current_cache[bus_id] = calculate_bus_fault_current_a(payload, bus_id)

        max_fault_current_a = fault_current_cache[bus_id]
        load_current_a = float(asset_context['load_current_a'])
        curve_points = generate_protection_curve_points(
            validated_device,
            load_current_a=load_current_a,
            max_fault_current_a=max_fault_current_a
        )
        curve_meta = PROTECTION_CURVE_LIBRARY[str(validated_device['curve_family'])]

        devices.append(
            {
                **validated_device,
                'bus_id': bus_id,
                'bus_role': asset_context['bus_role'],
                'bus_voltage_kv': round(float(asset_context['bus_voltage_kv']), 5),
                'load_current_a': round(load_current_a, 5),
                'max_fault_current_a': round(max_fault_current_a, 5),
                'curve_points_count': len(curve_points)
            }
        )
        curves.append(
            {
                'device_id': str(validated_device['asset_id']),
                'device_name': str(validated_device['name']),
                'asset_id': str(validated_device['asset_id']),
                'asset_type': str(validated_device['asset_type']),
                'device_type': str(validated_device['device_type']),
                'bus_id': bus_id,
                'bus_role': asset_context['bus_role'],
                'bus_voltage_kv': round(float(asset_context['bus_voltage_kv']), 5),
                'phase_mode': str(validated_device['phase_mode']),
                'curve_family': str(validated_device['curve_family']),
                'curve_family_label': curve_meta['label'],
                'curve_standard': curve_meta['standard'],
                'pickup_current_a': float(validated_device['pickup_current_a']),
                'time_dial': float(validated_device['time_dial']),
                'instantaneous_pickup_a': validated_device['instantaneous_pickup_a'],
                'clearing_time_adder_s': float(validated_device['clearing_time_adder_s']),
                'load_current_a': round(load_current_a, 5),
                'max_fault_current_a': round(max_fault_current_a, 5),
                'points': curve_points
            }
        )

    analysis = analyze_protection_coordination(curves, float(payload.coordination_margin_s))

    return {
        'status': 'completed',
        'message': (
            f'Generated time-current characteristic curves for {len(curves)} configured protection device(s).'
        ),
        'summary': {
            'device_count': len(validated_devices),
            'curve_count': len(curves),
            'coordination_margin_s': round(float(payload.coordination_margin_s), 5),
            'bus_fault_levels': {
                bus_id: round(current_a, 5) for bus_id, current_a in fault_current_cache.items()
            }
        },
        'devices': devices,
        'curves': curves,
        'analysis': analysis
    }

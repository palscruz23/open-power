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


class ArcFlashFaultClearingInput(BaseModel):
    mode: Literal['fixed_time', 'protective_device'] = 'fixed_time'
    duration_s: float | None = Field(default=None, gt=0)
    device_id: str | None = None


class ArcFlashInput(SharedNetworkInput):
    method: Literal['ieee_1584'] = 'ieee_1584'
    study_bus_id: str
    equipment_label: str = Field(min_length=1)
    equipment_class: Literal['switchboard', 'switchgear', 'mcc']
    enclosure_type: Literal['enclosed', 'open_air'] = 'enclosed'
    working_distance_mm: float = Field(gt=0)
    fault_clearing: ArcFlashFaultClearingInput = Field(default_factory=ArcFlashFaultClearingInput)


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
        if bus.id in bus_map:
            raise HTTPException(status_code=400, detail=f'Duplicate bus id "{bus.id}" is not allowed.')
        bus_map[bus.id] = pp.create_bus(net, vn_kv=bus.vn_kv, name=bus.name)

    for line in payload.lines:
        if line.from_bus not in bus_map or line.to_bus not in bus_map:
            raise HTTPException(status_code=400, detail=f'Invalid line bus reference: {line.id}')
        if line.from_bus == line.to_bus:
            raise HTTPException(
                status_code=400,
                detail=f'Line {line.id} must connect two distinct buses.'
            )
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


def build_bus_adjacency(payload: SharedNetworkInput) -> Dict[str, set[str]]:
    adjacency: Dict[str, set[str]] = {bus.id: set() for bus in payload.buses}

    for line in payload.lines:
        if line.from_bus in adjacency and line.to_bus in adjacency:
            adjacency[line.from_bus].add(line.to_bus)
            adjacency[line.to_bus].add(line.from_bus)

    for transformer in payload.transformers:
        if transformer.hv_bus in adjacency and transformer.lv_bus in adjacency:
            adjacency[transformer.hv_bus].add(transformer.lv_bus)
            adjacency[transformer.lv_bus].add(transformer.hv_bus)

    return adjacency


def get_source_reachable_bus_ids(payload: SharedNetworkInput) -> set[str]:
    source_bus_ids = {generator.bus for generator in payload.generators if generator.bus}
    if len(source_bus_ids) == 0:
        return set()

    adjacency = build_bus_adjacency(payload)
    reachable_bus_ids = {bus_id for bus_id in source_bus_ids if bus_id in adjacency}
    pending_bus_ids = list(reachable_bus_ids)

    while pending_bus_ids:
        bus_id = pending_bus_ids.pop()
        for neighbor_bus_id in adjacency.get(bus_id, set()):
            if neighbor_bus_id in reachable_bus_ids:
                continue
            reachable_bus_ids.add(neighbor_bus_id)
            pending_bus_ids.append(neighbor_bus_id)

    return reachable_bus_ids


def ensure_advanced_study_sources(payload: SharedNetworkInput, study_label: str) -> set[str]:
    if len(payload.generators) == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f'{study_label} requires at least one connected generator or utility source in the study network. '
                'Add a source and connect it to the buses involved in the study before running this analysis.'
            )
        )

    reachable_bus_ids = get_source_reachable_bus_ids(payload)
    if len(reachable_bus_ids) == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f'{study_label} could not find any buses electrically connected to a generator or utility source. '
                'Check source bus assignments and network connectivity before running this analysis.'
            )
        )

    return reachable_bus_ids


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
                'Calculated from pandapower IEC 60909 max-case results, then converted to an ANSI-oriented '
                'nominal-voltage duty because this release does not yet implement a full ANSI C37 network engine.'
            ),
            'limitations': [
                'ANSI mode currently supports only three-phase faults.',
                'ANSI thermal equivalent current is not available in this release.',
                'ANSI duties are derived from the IEC 60909 max-case engine with a nominal-voltage conversion, '
                'so source-specific ANSI decrement and breaker-duty options are not separately modeled yet.'
            ],
            'voltage_factor_mode': 'nominal_from_iec_max',
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
        'voltage_factor_mode': 'iec_max',
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


def get_iec_max_voltage_factor(voltage_kv: float) -> float:
    # IEC 60909 max-case studies apply an operating-voltage factor above nominal voltage.
    return 1.1 if voltage_kv > 1.0 else 1.05


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
            if device.asset_type == 'transformer':
                detail = (
                    f'Protection device "{device.name or device.asset_id}" references transformer '
                    f'"{device.asset_id}", but that transformer is not available for coordination. '
                    'Connect the transformer to two buses before assigning protection.'
                )
            else:
                detail = (
                    f'Protection device "{device.name or device.asset_id}" references asset '
                    f'"{device.asset_id}", but that asset is not connected to a bus in the current study network. '
                    'Connect the asset before running protection coordination.'
                )
            raise HTTPException(
                status_code=400,
                detail=detail
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
        if settings.phase_mode != 'phase':
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{device.name or device.asset_id}" uses "{settings.phase_mode}" mode, '
                    'but protection coordination currently supports phase devices only. Use phase mode for this '
                    'release.'
                )
            )
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


def validate_arc_flash_study(payload: ArcFlashInput) -> Dict[str, object]:
    reachable_bus_ids = ensure_advanced_study_sources(payload, 'Arc flash')

    if payload.study_bus_id not in {bus.id for bus in payload.buses}:
        raise HTTPException(
            status_code=400,
            detail=f'Arc-flash study bus "{payload.study_bus_id}" does not exist in the active network.'
        )

    if payload.study_bus_id not in reachable_bus_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Arc-flash study bus "{payload.study_bus_id}" is not electrically connected to any generator or '
                'utility source in the active study network.'
            )
        )

    equipment_label = payload.equipment_label.strip()
    if len(equipment_label) == 0:
        raise HTTPException(status_code=400, detail='Arc-flash equipment label is required.')

    clearing = payload.fault_clearing
    if clearing.mode == 'fixed_time':
        if clearing.duration_s is None:
            raise HTTPException(
                status_code=400,
                detail='Arc-flash fixed clearing time is required when the fixed-time assumption is selected.'
            )
        if clearing.device_id:
            raise HTTPException(
                status_code=400,
                detail='Arc-flash fixed clearing time mode cannot also reference a protection device.'
            )
    else:
        if not clearing.device_id or len(clearing.device_id.strip()) == 0:
            raise HTTPException(
                status_code=400,
                detail='Select a protection device when arc-flash clearing time is based on device assumptions.'
            )

        known_device = next(
            (device for device in payload.protection_devices if device.asset_id == clearing.device_id),
            None
        )
        if known_device is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Arc-flash clearing device "{clearing.device_id}" is not available in the active network. '
                    'Configure protection on the referenced asset before using device-based clearing assumptions.'
                )
            )

    study_bus = next(bus for bus in payload.buses if bus.id == payload.study_bus_id)
    return {
        'study_bus': study_bus,
        'equipment_label': equipment_label,
    }


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


ARC_FLASH_EQUIPMENT_LIBRARY = {
    'switchgear': {
        'display_name': 'Switchgear',
        'gap_mm': 32.0,
        'arc_current_ratio': 0.88,
        'arc_efficiency': 0.42,
        'enclosed_focus_factor': 2.25,
        'open_air_focus_factor': 1.35,
        'distance_exponent': 1.55,
    },
    'switchboard': {
        'display_name': 'Switchboard',
        'gap_mm': 25.0,
        'arc_current_ratio': 0.78,
        'arc_efficiency': 0.38,
        'enclosed_focus_factor': 2.45,
        'open_air_focus_factor': 1.4,
        'distance_exponent': 1.6,
    },
    'mcc': {
        'display_name': 'Motor Control Center',
        'gap_mm': 13.0,
        'arc_current_ratio': 0.68,
        'arc_efficiency': 0.34,
        'enclosed_focus_factor': 2.8,
        'open_air_focus_factor': None,
        'distance_exponent': 1.65,
    },
}


ARC_FLASH_INCIDENT_ENERGY_REFERENCE_CAL_CM2 = 1.2
ARC_FLASH_SEVERITY_BANDS = (
    {
        'id': 'minimal',
        'label': 'Minimal Energy',
        'max_cal_cm2': 1.2,
        'summary_label': 'Minimal energy exposure',
    },
    {
        'id': 'moderate',
        'label': 'Moderate Energy',
        'max_cal_cm2': 4.0,
        'summary_label': 'Moderate arc-flash exposure',
    },
    {
        'id': 'elevated',
        'label': 'Elevated Energy',
        'max_cal_cm2': 8.0,
        'summary_label': 'Elevated arc-flash exposure',
    },
    {
        'id': 'high',
        'label': 'High Energy',
        'max_cal_cm2': 25.0,
        'summary_label': 'High arc-flash exposure',
    },
    {
        'id': 'extreme',
        'label': 'Extreme Energy',
        'max_cal_cm2': None,
        'summary_label': 'Extreme arc-flash exposure',
    },
)

ARC_FLASH_PPE_CATEGORIES = (
    {
        'category': 'PPE 1',
        'max_cal_cm2': 4.0,
        'summary_label': 'PPE 1 guidance available',
    },
    {
        'category': 'PPE 2',
        'max_cal_cm2': 8.0,
        'summary_label': 'PPE 2 guidance available',
    },
    {
        'category': 'PPE 3',
        'max_cal_cm2': 25.0,
        'summary_label': 'PPE 3 guidance available',
    },
    {
        'category': 'PPE 4',
        'max_cal_cm2': 40.0,
        'summary_label': 'PPE 4 guidance available',
    },
)


def get_arc_flash_equipment_config(payload: ArcFlashInput) -> Dict[str, float | str | None]:
    equipment_config = ARC_FLASH_EQUIPMENT_LIBRARY.get(payload.equipment_class)
    if equipment_config is None:
        raise HTTPException(
            status_code=400,
            detail=f'Arc-flash equipment class "{payload.equipment_class}" is not supported in this release.'
        )

    if payload.enclosure_type == 'open_air' and equipment_config['open_air_focus_factor'] is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Arc-flash studies for {equipment_config["display_name"]} equipment currently support '
                'enclosed equipment only.'
            )
        )

    return equipment_config


def derive_arc_flash_severity_band(incident_energy_cal_cm2: float) -> Dict[str, str]:
    for band in ARC_FLASH_SEVERITY_BANDS:
        max_value = band['max_cal_cm2']
        if max_value is None or incident_energy_cal_cm2 <= max_value:
            return {
                'id': band['id'],
                'label': band['label'],
                'summary_label': band['summary_label']
            }

    fallback_band = ARC_FLASH_SEVERITY_BANDS[-1]
    return {
        'id': fallback_band['id'],
        'label': fallback_band['label'],
        'summary_label': fallback_band['summary_label']
    }


def derive_arc_flash_ppe_category(incident_energy_cal_cm2: float) -> Dict[str, str] | None:
    for category in ARC_FLASH_PPE_CATEGORIES:
        if incident_energy_cal_cm2 <= category['max_cal_cm2']:
            return {
                'category': category['category'],
                'summary_label': category['summary_label']
            }
    return None


def build_arc_flash_guidance(
    payload: ArcFlashInput,
    incident_energy_cal_cm2: float,
    clearing_summary: Dict[str, object]
) -> Dict[str, object]:
    severity_band = derive_arc_flash_severity_band(incident_energy_cal_cm2)
    missing_assumptions: List[str] = []
    unsupported_labels: List[str] = []
    cautions: List[str] = []
    confidence_level = 'supported'

    ppe_category = None
    if payload.method != 'ieee_1584':
        unsupported_labels.append(
            f'PPE guidance is only defined for IEEE 1584 studies in this release; method "{payload.method}" is not supported.'
        )
    elif payload.enclosure_type != 'enclosed':
        unsupported_labels.append(
            'PPE guidance is withheld for open-air equipment because this release only maps simplified PPE categories for enclosed equipment assumptions.'
        )
    else:
        ppe_category = derive_arc_flash_ppe_category(incident_energy_cal_cm2)
        if ppe_category is None:
            unsupported_labels.append(
                'PPE guidance is withheld above 40 cal/cm^2; treat this location as requiring detailed engineering review instead of a derived category.'
            )

    if clearing_summary.get('mode') == 'protective_device':
        confidence_level = 'review'
        cautions.append(
            'PPE and severity guidance uses a protective-device clearing estimate derived from the configured TCC settings rather than measured relay logic or coordination study output.'
        )

    if payload.enclosure_type == 'open_air':
        confidence_level = 'review'
        cautions.append(
            'Open-air equipment uses the same simplified arcing-current model but should be reviewed carefully before converting the result into work-practice controls.'
        )

    guidance_label_parts = []
    if ppe_category is not None:
        guidance_label_parts.append(ppe_category['category'])
    if severity_band.get('label'):
        guidance_label_parts.append(severity_band['label'])

    return {
        'confidence': {
            'level': confidence_level,
            'label': 'Supported guidance' if confidence_level == 'supported' else 'Engineering review recommended'
        },
        'severity_band': severity_band,
        'ppe_category': ppe_category,
        'summary_label': ' / '.join(guidance_label_parts) if guidance_label_parts else severity_band['label'],
        'missing_assumptions': missing_assumptions,
        'unsupported_labels': unsupported_labels,
        'cautions': cautions
    }


def validate_arc_flash_method_scope(payload: ArcFlashInput, study_bus: Bus) -> None:
    voltage_kv = float(study_bus.vn_kv)
    if voltage_kv < 0.208 or voltage_kv > 15.0:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Arc-flash calculations for bus "{study_bus.id}" require nominal voltage between 0.208 kV '
                f'and 15 kV in this release. The selected bus is {round(voltage_kv, 5)} kV.'
            )
        )


def build_arc_flash_protection_payload(payload: ArcFlashInput) -> ProtectionStudyInput:
    return ProtectionStudyInput(**payload.model_dump())


def calculate_arc_flash_fault_current_a(payload: ArcFlashInput, bus_id: str) -> float:
    protection_payload = build_arc_flash_protection_payload(payload)
    return calculate_bus_fault_current_a(protection_payload, bus_id)


def estimate_arc_flash_arcing_current_a(
    bolted_fault_current_a: float,
    voltage_kv: float,
    equipment_config: Dict[str, float | str | None],
    enclosure_type: str
) -> float:
    voltage_factor = max(0.82, min(1.18, 0.92 + 0.09 * math.log10((voltage_kv * 1000.0) / 480.0)))
    enclosure_factor = 1.05 if enclosure_type == 'enclosed' else 0.96
    gap_factor = max(0.82, min(1.08, 1.0 - ((float(equipment_config['gap_mm']) - 25.0) / 180.0)))
    arcing_current_a = bolted_fault_current_a * float(equipment_config['arc_current_ratio']) * voltage_factor
    arcing_current_a *= enclosure_factor * gap_factor
    return max(arcing_current_a, bolted_fault_current_a * 0.25)


def calculate_arc_flash_device_operating_time_s(
    device: Dict[str, object],
    current_a: float
) -> float:
    pickup_current_a = float(device['pickup_current_a'])
    instantaneous_pickup_a = device.get('instantaneous_pickup_a')
    instantaneous_pickup_a = float(instantaneous_pickup_a) if instantaneous_pickup_a is not None else None
    clearing_time_adder_s = float(device['clearing_time_adder_s'])

    if instantaneous_pickup_a is not None and current_a >= instantaneous_pickup_a:
        base_time_s = 0.03 if device['device_type'] == 'fuse' else 0.05
        return round(base_time_s + clearing_time_adder_s, 5)

    multiple = current_a / pickup_current_a if pickup_current_a > 0 else 0.0
    if multiple <= 1.0:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Protection device "{device["name"]}" does not operate for the estimated arc current of '
                f'{round(current_a, 3)} A because its pickup is {round(pickup_current_a, 3)} A.'
            )
        )

    operating_time_s = evaluate_protection_operating_time(
        str(device['curve_family']),
        multiple,
        float(device['time_dial'])
    )
    return round(operating_time_s + clearing_time_adder_s, 5)


def resolve_arc_flash_clearing_summary(
    payload: ArcFlashInput,
    arcing_current_a: float
) -> Dict[str, object]:
    clearing = payload.fault_clearing
    if clearing.mode == 'fixed_time':
        duration_s = round(float(clearing.duration_s), 5)
        return {
            'mode': clearing.mode,
            'duration_s': duration_s,
            'device_id': None,
            'device_name': None,
            'assumption_label': f'Fixed clearing time of {duration_s} s',
        }

    protection_payload = build_arc_flash_protection_payload(payload)
    validated_devices = validate_protection_study(protection_payload)
    selected_device = next(
        (device for device in validated_devices if str(device['asset_id']) == str(clearing.device_id)),
        None
    )
    if selected_device is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Arc-flash clearing device "{clearing.device_id}" is not valid for protection-based clearing '
                'time assumptions in this release.'
            )
        )

    reduced_arcing_current_a = arcing_current_a * 0.85
    operating_time_s = calculate_arc_flash_device_operating_time_s(selected_device, arcing_current_a)
    if reduced_arcing_current_a > float(selected_device['pickup_current_a']):
        operating_time_s = max(
            operating_time_s,
            calculate_arc_flash_device_operating_time_s(selected_device, reduced_arcing_current_a)
        )

    duration_s = round(float(operating_time_s), 5)
    return {
        'mode': clearing.mode,
        'duration_s': duration_s,
        'device_id': str(selected_device['asset_id']),
        'device_name': str(selected_device['name']),
        'device_type': str(selected_device['device_type']),
        'curve_family': str(selected_device['curve_family']),
        'pickup_current_a': round(float(selected_device['pickup_current_a']), 5),
        'instantaneous_pickup_a': (
            round(float(selected_device['instantaneous_pickup_a']), 5)
            if selected_device['instantaneous_pickup_a'] is not None
            else None
        ),
        'assumption_label': (
            f'Protection device {selected_device["name"]} operating on estimated arc current'
        ),
    }


def calculate_arc_flash_incident_energy(
    study_bus: Bus,
    working_distance_mm: float,
    equipment_config: Dict[str, float | str | None],
    enclosure_type: str,
    arcing_current_a: float,
    clearing_time_s: float
) -> Dict[str, float]:
    voltage_v = float(study_bus.vn_kv) * 1000.0
    working_distance_mm = float(working_distance_mm)
    working_distance_m = working_distance_mm / 1000.0
    distance_exponent = float(equipment_config['distance_exponent'])
    normalized_distance_m = 0.455
    raw_arc_energy_j = (
        math.sqrt(3.0)
        * voltage_v
        * arcing_current_a
        * clearing_time_s
        * float(equipment_config['arc_efficiency'])
    )
    focus_factor = (
        float(equipment_config['enclosed_focus_factor'])
        if enclosure_type == 'enclosed'
        else float(equipment_config['open_air_focus_factor'])
    )
    normalized_incident_energy_cal_cm2 = (
        raw_arc_energy_j
        * focus_factor
        / (4.0 * math.pi * ((normalized_distance_m * 100.0) ** 2.0))
        / 4.184
    )
    incident_energy_cal_cm2 = normalized_incident_energy_cal_cm2 * (
        (normalized_distance_m / working_distance_m) ** distance_exponent
    )
    return {
        'normalized_incident_energy_cal_cm2': round(normalized_incident_energy_cal_cm2, 5),
        'incident_energy_cal_cm2': round(incident_energy_cal_cm2, 5),
        'distance_exponent': round(distance_exponent, 5),
        'focus_factor': round(focus_factor, 5),
        'raw_arc_energy_kj': round(raw_arc_energy_j / 1000.0, 5),
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

    reachable_bus_ids = ensure_advanced_study_sources(payload, 'Short circuit')
    net, bus_map = build_network(payload, use_motor_elements=True)
    standard_cfg = get_short_circuit_standard_config(payload)

    if payload.fault_bus_id not in bus_map:
        raise HTTPException(status_code=400, detail=f'Invalid fault bus reference: {payload.fault_bus_id}')
    if payload.fault_bus_id not in reachable_bus_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Selected fault bus "{payload.fault_bus_id}" is not electrically connected to any generator or '
                'utility source in the active study network. Connect the faulted bus to a source before running '
                'short-circuit analysis.'
            )
        )

    fault_map = {
        'three_phase': '3ph',
        'single_phase': '2ph',
        'earth_fault': '1ph'
    }
    fault_code = fault_map[payload.fault_type]
    fault_bus_idx = bus_map[payload.fault_bus_id]
    current_type_config = standard_cfg['current_types']
    selected_current_cfg = current_type_config[payload.current_type]
    fault_bus_voltage_kv = float(net.bus.loc[fault_bus_idx, 'vn_kv'])
    voltage_factor = get_iec_max_voltage_factor(fault_bus_voltage_kv)
    current_scale = 1.0
    if standard_cfg.get('voltage_factor_mode') == 'nominal_from_iec_max':
        current_scale = 1.0 / voltage_factor

    try:
        sc.calc_sc(net, case='max', bus=fault_bus_idx, fault=fault_code, branch_results=True, ip=True, ith=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Short circuit failed: {exc}') from exc

    if fault_bus_idx not in net.res_bus_sc.index:
        raise HTTPException(status_code=400, detail='Short circuit results not available for selected fault bus.')

    bus_result = net.res_bus_sc.loc[fault_bus_idx]
    index_to_bus_id = {index: bus_id for bus_id, index in bus_map.items()}

    def scale_current(current: float | None) -> float | None:
        if current is None:
            return None
        scaled = float(current) * current_scale
        if not math.isfinite(scaled):
            return None
        return scaled

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

            current_from = scale_current(read_float(row, selected_current_cfg['from_candidates']))
            current_to = scale_current(read_float(row, selected_current_cfg['to_candidates']))
            current_mid = scale_current(read_float(row, selected_current_cfg['mid_candidates']))
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

            current_from = scale_current(read_float(row, selected_current_cfg['trafo_from_candidates']))
            current_to = scale_current(read_float(row, selected_current_cfg['trafo_to_candidates']))
            current_mid = scale_current(read_float(row, selected_current_cfg['trafo_mid_candidates']))
            branches[result_key] = make_branch_result(
                index_to_bus_id.get(hv_bus_idx, ''),
                index_to_bus_id.get(lv_bus_idx, ''),
                current_from,
                current_to,
                current_mid
            )

    fault_bus_current = scale_current(read_float(bus_result, selected_current_cfg['bus_candidates']))
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
            'voltage_factor_mode': standard_cfg.get('voltage_factor_mode'),
            'applied_voltage_factor': round(voltage_factor, 5),
            'current_scale': round(current_scale, 5),
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
    reachable_bus_ids = ensure_advanced_study_sources(payload, 'Protection coordination')
    load_flow_context = build_protection_load_flow_context(payload)
    fault_current_cache: Dict[str, float] = {}
    devices: List[Dict[str, object]] = []
    curves: List[Dict[str, object]] = []

    for validated_device in validated_devices:
        asset_context = build_protection_asset_context(payload, validated_device, load_flow_context)
        bus_id = str(asset_context['bus_id'])
        if bus_id not in reachable_bus_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Protection device "{validated_device["name"]}" is assigned to bus "{bus_id}", but that bus '
                    'is not electrically connected to any generator or utility source in the active study network. '
                    'Connect the protected asset to an energized bus before running coordination.'
                )
            )
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


@app.post('/api/calculate/arc-flash')
def calculate_arc_flash(payload: ArcFlashInput):
    context = validate_arc_flash_study(payload)
    study_bus = context['study_bus']
    equipment_label = context['equipment_label']
    validate_arc_flash_method_scope(payload, study_bus)
    equipment_config = get_arc_flash_equipment_config(payload)
    bolted_fault_current_a = calculate_arc_flash_fault_current_a(payload, payload.study_bus_id)
    arcing_current_a = estimate_arc_flash_arcing_current_a(
        bolted_fault_current_a=bolted_fault_current_a,
        voltage_kv=float(study_bus.vn_kv),
        equipment_config=equipment_config,
        enclosure_type=payload.enclosure_type
    )
    clearing_summary = resolve_arc_flash_clearing_summary(payload, arcing_current_a)
    clearing_time_s = float(clearing_summary['duration_s'])
    energy_summary = calculate_arc_flash_incident_energy(
        study_bus=study_bus,
        working_distance_mm=float(payload.working_distance_mm),
        equipment_config=equipment_config,
        enclosure_type=payload.enclosure_type,
        arcing_current_a=arcing_current_a,
        clearing_time_s=clearing_time_s
    )
    incident_energy_cal_cm2 = float(energy_summary['incident_energy_cal_cm2'])
    distance_exponent = float(energy_summary['distance_exponent'])
    arc_flash_boundary_mm = max(
        float(payload.working_distance_mm),
        float(payload.working_distance_mm)
        * ((incident_energy_cal_cm2 / ARC_FLASH_INCIDENT_ENERGY_REFERENCE_CAL_CM2) ** (1.0 / distance_exponent))
    )
    guidance = build_arc_flash_guidance(payload, incident_energy_cal_cm2, clearing_summary)

    return {
        'status': 'completed',
        'message': (
            f'Calculated arc-flash incident energy for {equipment_label} at bus "{payload.study_bus_id}" '
            'using the configured IEEE 1584 study assumptions.'
        ),
        'summary': {
            'incident_energy_cal_cm2': round(incident_energy_cal_cm2, 5),
            'arc_flash_boundary_mm': round(float(arc_flash_boundary_mm), 5),
            'available_fault_current_ka': round(bolted_fault_current_a / 1000.0, 5),
            'arcing_current_ka': round(arcing_current_a / 1000.0, 5),
            'clearing_time_s': round(clearing_time_s, 5),
            'severity_band': guidance['severity_band']['label'],
            'ppe_category': guidance['ppe_category']['category'] if guidance['ppe_category'] else None,
        },
        'assumptions': {
            'method': payload.method,
            'study_bus_id': payload.study_bus_id,
            'study_bus_name': study_bus.name,
            'study_bus_voltage_kv': round(float(study_bus.vn_kv), 5),
            'equipment_label': equipment_label,
            'equipment_class': payload.equipment_class,
            'enclosure_type': payload.enclosure_type,
            'working_distance_mm': round(float(payload.working_distance_mm), 5),
            'fault_clearing': clearing_summary
        },
        'calculation': {
            'available_bolted_fault_current_ka': round(bolted_fault_current_a / 1000.0, 5),
            'estimated_arcing_current_ka': round(arcing_current_a / 1000.0, 5),
            'electrode_gap_mm': round(float(equipment_config['gap_mm']), 5),
            'distance_exponent': energy_summary['distance_exponent'],
            'focus_factor': energy_summary['focus_factor'],
            'normalized_incident_energy_cal_cm2': energy_summary['normalized_incident_energy_cal_cm2'],
            'raw_arc_energy_kj': energy_summary['raw_arc_energy_kj'],
        },
        'guidance': guidance,
        'limitations': [
            'This release uses a simplified IEEE 1584-inspired empirical model derived from the network short-circuit current, equipment class, enclosure type, and working distance.',
            'Only three-phase AC studies between 0.208 kV and 15 kV are supported; electrode configuration, conductor geometry, and enclosure dimensions are not user-configurable yet.',
            'The arc-flash boundary is reported at 1.2 cal/cm^2 and assumes the same distance exponent applies beyond the entered working distance.',
            'Protection-device clearing time assumptions use the configured TCC settings and estimated arcing current at the selected study bus; detailed relay logic, zone selectivity, and reduced-voltage arc tracking are not modeled.'
        ]
    }

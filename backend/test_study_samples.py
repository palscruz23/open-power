from copy import deepcopy

from backend.main import ArcFlashInput, LoadFlowInput, ProtectionStudyInput, ShortCircuitInput


def _deep_update(base, overrides):
    payload = deepcopy(base)
    payload.update(overrides)
    return payload


def make_radial_network_payload(**overrides):
    base = {
        'buses': [
            {'id': 'bus-1', 'name': 'Source', 'vn_kv': 11.0},
            {'id': 'bus-2', 'name': 'Load Bus', 'vn_kv': 11.0},
        ],
        'lines': [
            {
                'id': 'line-1',
                'from_bus': 'bus-1',
                'to_bus': 'bus-2',
                'length_km': 1.0,
                'r_ohm_per_km': 0.08,
                'x_ohm_per_km': 0.12,
                'c_nf_per_km': 10.0,
                'max_i_ka': 1.0,
            }
        ],
        'loads': [
            {'id': 'load-1', 'bus': 'bus-2', 'p_mw': 1.0, 'q_mvar': 0.2, 'load_type': 'static'}
        ],
        'generators': [
            {'id': 'source-1', 'bus': 'bus-1', 'p_mw': 0.0, 'vm_pu': 1.0}
        ],
        'transformers': [],
        'protection_devices': [],
    }
    return _deep_update(base, overrides)


def make_load_flow_payload(**overrides):
    return LoadFlowInput(**make_radial_network_payload(**overrides))


def make_load_flow_input(**overrides):
    return make_load_flow_payload(**overrides)


def make_short_circuit_payload(**overrides):
    base = {
        'standard': 'ansi',
        'fault_bus_id': 'bus-2',
        'fault_type': 'three_phase',
        'current_type': 'initial_symmetrical',
    }
    base.update(overrides)
    return ShortCircuitInput(**make_radial_network_payload(**base))


def make_short_circuit_input(**overrides):
    return make_short_circuit_payload(**overrides)


def make_transformer_short_circuit_payload(**overrides):
    base = {
        'buses': [
            {'id': 'bus-1', 'name': 'Transformer HV', 'vn_kv': 33.0},
            {'id': 'bus-2', 'name': 'Transformer LV', 'vn_kv': 11.0},
        ],
        'lines': [],
        'loads': [
            {'id': 'load-1', 'bus': 'bus-2', 'p_mw': 1.0, 'q_mvar': 0.2, 'load_type': 'static'}
        ],
        'generators': [
            {'id': 'source-1', 'bus': 'bus-1', 'p_mw': 0.0, 'vm_pu': 1.0}
        ],
        'transformers': [
            {
                'id': 'tx-1',
                'hv_bus': 'bus-1',
                'lv_bus': 'bus-2',
                'sn_mva': 10.0,
                'vn_hv_kv': 33.0,
                'vn_lv_kv': 11.0,
                'vk_percent': 6.0,
                'vkr_percent': 0.6,
                'vector_group': 'Dyn11',
                'shift_degree': 0.0,
            }
        ],
        'protection_devices': [],
        'standard': 'ansi',
        'fault_bus_id': 'bus-2',
        'fault_type': 'three_phase',
        'current_type': 'initial_symmetrical',
    }
    return ShortCircuitInput(**_deep_update(base, overrides))


def make_transformer_short_circuit_input(**overrides):
    return make_transformer_short_circuit_payload(**overrides)


def make_protection_payload(**overrides):
    base = {
        'coordination_margin_s': 0.3,
        'buses': [
            {'id': 'bus-1', 'name': 'Source', 'vn_kv': 33.0},
            {'id': 'bus-2', 'name': 'Main Bus', 'vn_kv': 11.0},
        ],
        'lines': [],
        'loads': [
            {'id': 'load-1', 'bus': 'bus-2', 'p_mw': 1.2, 'q_mvar': 0.3, 'load_type': 'motor'}
        ],
        'generators': [
            {'id': 'source-1', 'bus': 'bus-1', 'p_mw': 0.0, 'vm_pu': 1.0}
        ],
        'transformers': [
            {
                'id': 'tx-1',
                'hv_bus': 'bus-1',
                'lv_bus': 'bus-2',
                'sn_mva': 10.0,
                'vn_hv_kv': 33.0,
                'vn_lv_kv': 11.0,
                'vk_percent': 6.0,
                'vkr_percent': 0.6,
                'vector_group': 'Dyn11',
                'shift_degree': 0.0,
            }
        ],
        'protection_devices': [
            {
                'asset_id': 'load-1',
                'asset_type': 'load',
                'device_type': 'oc_relay',
                'name': 'Motor Relay',
                'settings': {
                    'phase_mode': 'phase',
                    'curve_family': 'iec_standard_inverse',
                    'pickup_current_a': 180.0,
                    'time_dial': 0.4,
                    'instantaneous_pickup_a': 600.0,
                    'clearing_time_adder_s': 0.05,
                },
            },
            {
                'asset_id': 'tx-1',
                'asset_type': 'transformer',
                'device_type': 'fuse',
                'name': 'TX Primary Fuse',
                'settings': {
                    'phase_mode': 'phase',
                    'curve_family': 'ansi_k',
                    'pickup_current_a': 250.0,
                    'time_dial': 0.2,
                    'clearing_time_adder_s': 0.0,
                },
            },
        ],
    }
    return ProtectionStudyInput(**_deep_update(base, overrides))


def make_protection_study_input(**overrides):
    return make_protection_payload(**overrides)


def make_arc_flash_payload(**overrides):
    base = {
        'method': 'ieee_1584',
        'study_bus_id': 'bus-2',
        'equipment_label': 'Main Switchboard Section A',
        'equipment_class': 'switchboard',
        'enclosure_type': 'enclosed',
        'working_distance_mm': 455.0,
        'fault_clearing': {
            'mode': 'fixed_time',
            'duration_s': 0.08,
            'device_id': None,
        },
    }
    return ArcFlashInput(**make_radial_network_payload(**_deep_update(base, overrides)))


def make_arc_flash_input(**overrides):
    return make_arc_flash_payload(**overrides)

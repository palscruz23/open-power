import unittest

from backend.main import LoadFlowInput, calculate_load_flow


class LoadFlowTests(unittest.TestCase):
    def make_payload(self, **overrides):
        payload = {
            'buses': [
                {'id': 'bus-1', 'name': 'Source', 'vn_kv': 11.0},
                {'id': 'bus-2', 'name': 'Load Bus', 'vn_kv': 11.0}
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
                    'max_i_ka': 1.0
                }
            ],
            'loads': [
                {'id': 'load-1', 'bus': 'bus-2', 'p_mw': 1.0, 'q_mvar': 0.2, 'load_type': 'static'}
            ],
            'generators': [
                {'id': 'source-1', 'bus': 'bus-1', 'p_mw': 0.0, 'vm_pu': 1.0}
            ],
            'transformers': []
        }
        payload.update(overrides)
        return LoadFlowInput(**payload)

    def test_load_flow_keeps_existing_payload_shape_compatible(self):
        result = calculate_load_flow(self.make_payload())

        self.assertIn('bus-1', result['buses'])
        self.assertIn('bus-2', result['buses'])
        self.assertIn('line-1', result['lines'])
        self.assertIn('load-1', result['loads'])
        self.assertGreater(result['loads']['load-1']['current_ka'], 0.0)

    def test_load_flow_ignores_protection_device_metadata(self):
        result = calculate_load_flow(
            self.make_payload(
                protection_devices=[
                    {
                        'asset_id': 'load-1',
                        'asset_type': 'load',
                        'device_type': 'oc_relay',
                        'name': 'Feeder Relay',
                        'settings': {
                            'phase_mode': 'phase',
                            'curve_family': 'iec_standard_inverse',
                            'pickup_current_a': 180.0,
                            'time_dial': 0.35,
                            'instantaneous_pickup_a': 720.0,
                            'clearing_time_adder_s': 0.05
                        }
                    }
                ]
            )
        )

        self.assertIn('line-1', result['lines'])
        self.assertIn('load-1', result['loads'])


if __name__ == '__main__':
    unittest.main()

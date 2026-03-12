import unittest

from backend.main import LoadFlowInput, calculate_load_flow
from backend.test_study_samples import make_load_flow_payload


class LoadFlowTests(unittest.TestCase):
    def make_payload(self, **overrides):
        return LoadFlowInput(**make_load_flow_payload(**overrides).model_dump())

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

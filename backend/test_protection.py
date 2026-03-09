import unittest

from fastapi import HTTPException

from backend.main import ProtectionStudyInput, calculate_protection_coordination


class ProtectionCoordinationTests(unittest.TestCase):
    def make_payload(self, **overrides):
        payload = {
            'coordination_margin_s': 0.3,
            'buses': [
                {'id': 'bus-1', 'name': 'Source', 'vn_kv': 33.0},
                {'id': 'bus-2', 'name': 'Main Bus', 'vn_kv': 11.0}
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
                    'shift_degree': 0.0
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
                        'clearing_time_adder_s': 0.05
                    }
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
                        'clearing_time_adder_s': 0.0
                    }
                }
            ]
        }
        payload.update(overrides)
        return ProtectionStudyInput(**payload)

    def test_protection_coordination_accepts_structured_device_inputs(self):
        result = calculate_protection_coordination(self.make_payload())

        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['summary']['device_count'], 2)
        self.assertEqual(result['summary']['curve_count'], 2)
        self.assertEqual(result['summary']['coordination_margin_s'], 0.3)
        self.assertEqual(result['devices'][0]['curve_family'], 'iec_standard_inverse')
        self.assertEqual(result['devices'][1]['asset_type'], 'transformer')
        self.assertGreater(result['devices'][0]['max_fault_current_a'], result['devices'][0]['pickup_current_a'])
        self.assertGreater(result['devices'][0]['curve_points_count'], 4)
        self.assertEqual(result['curves'][0]['curve_family_label'], 'IEC Standard Inverse')
        self.assertTrue(any(point['region'] == 'inverse' for point in result['curves'][0]['points']))
        self.assertGreater(result['curves'][0]['points'][-1]['current_a'], result['curves'][0]['points'][0]['current_a'])

    def test_protection_coordination_rejects_missing_required_device_settings(self):
        with self.assertRaises(HTTPException) as context:
            calculate_protection_coordination(
                self.make_payload(
                    protection_devices=[
                        {
                            'asset_id': 'load-1',
                            'asset_type': 'load',
                            'device_type': 'oc_relay',
                            'name': 'Incomplete Relay',
                            'settings': {
                                'phase_mode': 'phase',
                                'curve_family': '',
                                'pickup_current_a': None,
                                'time_dial': None
                            }
                        }
                    ]
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('missing required settings', context.exception.detail)

    def test_protection_coordination_rejects_insufficient_fault_current_range(self):
        with self.assertRaises(HTTPException) as context:
            calculate_protection_coordination(
                self.make_payload(
                    protection_devices=[
                        {
                            'asset_id': 'load-1',
                            'asset_type': 'load',
                            'device_type': 'oc_relay',
                            'name': 'Overpicked Relay',
                            'settings': {
                                'phase_mode': 'phase',
                                'curve_family': 'iec_standard_inverse',
                                'pickup_current_a': 20000.0,
                                'time_dial': 0.4,
                                'instantaneous_pickup_a': None,
                                'clearing_time_adder_s': 0.05
                            }
                        }
                    ]
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('available three-phase fault current', context.exception.detail)


if __name__ == '__main__':
    unittest.main()

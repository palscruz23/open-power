import unittest

from fastapi import HTTPException

from backend.main import ProtectionStudyInput, calculate_protection_coordination
from backend.test_study_samples import make_protection_payload


class ProtectionCoordinationTests(unittest.TestCase):
    def make_payload(self, **overrides):
        return ProtectionStudyInput(**make_protection_payload(**overrides).model_dump())

    def test_protection_coordination_accepts_structured_device_inputs(self):
        result = calculate_protection_coordination(self.make_payload())

        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['summary']['device_count'], 2)
        self.assertEqual(result['summary']['curve_count'], 2)
        self.assertEqual(result['summary']['coordination_margin_s'], 0.3)
        self.assertIn('analysis', result)
        self.assertIn('warnings', result['analysis'])
        self.assertIn('scope_notes', result['analysis'])
        self.assertEqual(result['devices'][0]['curve_family'], 'iec_standard_inverse')
        self.assertEqual(result['devices'][1]['asset_type'], 'transformer')
        self.assertGreater(result['devices'][0]['max_fault_current_a'], result['devices'][0]['pickup_current_a'])
        self.assertGreater(result['devices'][0]['curve_points_count'], 4)
        self.assertEqual(result['curves'][0]['curve_family_label'], 'IEC Standard Inverse')
        self.assertTrue(any(point['region'] == 'inverse' for point in result['curves'][0]['points']))
        self.assertGreater(result['curves'][0]['points'][-1]['current_a'], result['curves'][0]['points'][0]['current_a'])
        self.assertTrue(
            any('out of scope' in note.lower() for note in result['analysis']['scope_notes'])
        )

    def test_protection_coordination_reports_overlap_warnings_for_tight_curve_spacing(self):
        result = calculate_protection_coordination(
            self.make_payload(
                protection_devices=[
                    {
                        'asset_id': 'load-1',
                        'asset_type': 'load',
                        'device_type': 'oc_relay',
                        'name': 'Motor Relay A',
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
                        'asset_id': 'load-1',
                        'asset_type': 'load',
                        'device_type': 'oc_relay',
                        'name': 'Motor Relay B',
                        'settings': {
                            'phase_mode': 'phase',
                            'curve_family': 'iec_standard_inverse',
                            'pickup_current_a': 185.0,
                            'time_dial': 0.42,
                            'instantaneous_pickup_a': 620.0,
                            'clearing_time_adder_s': 0.05
                        }
                    }
                ]
            )
        )

        self.assertGreaterEqual(result['analysis']['warning_count'], 1)
        first_warning = result['analysis']['warnings'][0]
        self.assertIn(first_warning['type'], {'overlap', 'ordering'})
        self.assertIn('Motor Relay A', first_warning['message'])
        self.assertIn('Motor Relay B', first_warning['message'])
        self.assertEqual(first_warning['segment_label'], 'shared bus bus-2')
        self.assertIn('from', first_warning['current_window_a'])
        self.assertIn('to', first_warning['current_window_a'])

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

    def test_protection_coordination_rejects_disconnected_asset_assignment(self):
        with self.assertRaises(HTTPException) as context:
            calculate_protection_coordination(
                self.make_payload(
                    protection_devices=[
                        {
                            'asset_id': 'missing-load',
                            'asset_type': 'load',
                            'device_type': 'oc_relay',
                            'name': 'Detached Relay',
                            'settings': {
                                'phase_mode': 'phase',
                                'curve_family': 'iec_standard_inverse',
                                'pickup_current_a': 180.0,
                                'time_dial': 0.4,
                                'instantaneous_pickup_a': 600.0,
                                'clearing_time_adder_s': 0.05
                            }
                        }
                    ]
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('not connected to a bus', context.exception.detail)

    def test_protection_coordination_rejects_ground_mode_devices(self):
        with self.assertRaises(HTTPException) as context:
            calculate_protection_coordination(
                self.make_payload(
                    protection_devices=[
                        {
                            'asset_id': 'load-1',
                            'asset_type': 'load',
                            'device_type': 'oc_relay',
                            'name': 'Ground Relay',
                            'settings': {
                                'phase_mode': 'ground',
                                'curve_family': 'iec_standard_inverse',
                                'pickup_current_a': 180.0,
                                'time_dial': 0.4,
                                'instantaneous_pickup_a': 600.0,
                                'clearing_time_adder_s': 0.05
                            }
                        }
                    ]
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('supports phase devices only', context.exception.detail)

    def test_protection_coordination_requires_connected_source(self):
        with self.assertRaises(HTTPException) as context:
            calculate_protection_coordination(self.make_payload(generators=[]))

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('requires at least one connected generator or utility source', context.exception.detail)
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

    def test_protection_coordination_rejects_device_bus_not_connected_to_source(self):
        with self.assertRaises(HTTPException) as context:
            calculate_protection_coordination(
                self.make_payload(
                    buses=[
                        {'id': 'bus-1', 'name': 'Source', 'vn_kv': 33.0},
                        {'id': 'bus-2', 'name': 'Main Bus', 'vn_kv': 11.0},
                        {'id': 'bus-3', 'name': 'Isolated Bus', 'vn_kv': 11.0}
                    ],
                    loads=[
                        {'id': 'load-1', 'bus': 'bus-3', 'p_mw': 1.2, 'q_mvar': 0.3, 'load_type': 'motor'}
                    ],
                    transformers=[],
                    protection_devices=[
                        {
                            'asset_id': 'load-1',
                            'asset_type': 'load',
                            'device_type': 'oc_relay',
                            'name': 'Isolated Relay',
                            'settings': {
                                'phase_mode': 'phase',
                                'curve_family': 'iec_standard_inverse',
                                'pickup_current_a': 180.0,
                                'time_dial': 0.4,
                                'instantaneous_pickup_a': 600.0,
                                'clearing_time_adder_s': 0.05
                            }
                        }
                    ]
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('not electrically connected to any generator or utility source', context.exception.detail)


if __name__ == '__main__':
    unittest.main()

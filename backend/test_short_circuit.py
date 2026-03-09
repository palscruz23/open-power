import unittest

from fastapi import HTTPException

from backend.main import ShortCircuitInput, calculate_short_circuit


class ShortCircuitTests(unittest.TestCase):
    def make_payload(self, **overrides):
        payload = {
            'standard': 'ansi',
            'fault_bus_id': 'bus-2',
            'fault_type': 'three_phase',
            'current_type': 'initial_symmetrical',
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
        return ShortCircuitInput(**payload)

    def test_ansi_short_circuit_returns_standard_aware_fault_and_branch_results(self):
        result = calculate_short_circuit(self.make_payload())

        self.assertEqual(result['fault']['standard'], 'ansi')
        self.assertEqual(result['fault']['standard_label'], 'ANSI')
        self.assertEqual(result['fault']['current_type_label'], 'ANSI symmetrical RMS current')
        self.assertEqual(result['fault']['current_result_key'], 'ikss_ka')
        self.assertTrue(result['fault']['limitations'])
        self.assertGreater(result['fault_bus']['current_ka'], 0.0)

        self.assertIn('line-1', result['branches'])
        self.assertGreater(result['branches']['line-1']['contribution_ka'], 0.0)
        self.assertEqual(result['branches']['line-1']['from_bus_id'], 'bus-1')
        self.assertEqual(result['branches']['line-1']['to_bus_id'], 'bus-2')

    def test_ansi_rejects_unsupported_fault_types(self):
        with self.assertRaises(HTTPException) as context:
            calculate_short_circuit(self.make_payload(fault_type='earth_fault'))

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('only three-phase faults', context.exception.detail)

    def test_short_circuit_rejects_impossible_self_connected_line(self):
        with self.assertRaises(HTTPException) as context:
            calculate_short_circuit(
                self.make_payload(
                    lines=[
                        {
                            'id': 'line-1',
                            'from_bus': 'bus-2',
                            'to_bus': 'bus-2',
                            'length_km': 1.0,
                            'r_ohm_per_km': 0.08,
                            'x_ohm_per_km': 0.12,
                            'c_nf_per_km': 10.0,
                            'max_i_ka': 1.0
                        }
                    ]
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('must connect two distinct buses', context.exception.detail)

    def test_iec_60909_thermal_results_use_iec_specific_labels_and_branch_keys(self):
        result = calculate_short_circuit(
            self.make_payload(standard='iec_60909', current_type='thermal_equivalent')
        )

        self.assertEqual(result['fault']['standard'], 'iec_60909')
        self.assertEqual(result['fault']['standard_label'], 'IEC 60909')
        self.assertEqual(result['fault']['current_type_label'], 'Thermal equivalent current')
        self.assertEqual(result['fault']['current_result_key'], 'ith_ka')
        self.assertEqual(result['fault']['limitations'], [])
        self.assertGreater(result['fault_bus']['current_ka'], 0.0)

        branch = result['branches']['line-1']
        self.assertEqual(branch['result_key'], 'ith_ka')
        self.assertEqual(branch['result_label'], 'Thermal equivalent current')
        self.assertGreater(branch['contribution_ka'], 0.0)
        self.assertIsNotNone(branch['from_ith_ka'])
        self.assertIsNotNone(branch['to_ith_ka'])
        self.assertIsNotNone(branch['ith_ka'])
        self.assertIsNone(branch['from_ikss_ka'])
        self.assertIsNone(branch['to_ikss_ka'])
        self.assertIsNone(branch['ikss_ka'])

    def test_short_circuit_accepts_protection_device_metadata_without_breaking_results(self):
        result = calculate_short_circuit(
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

        self.assertEqual(result['fault']['standard'], 'ansi')
        self.assertGreater(result['fault_bus']['current_ka'], 0.0)
        self.assertIn('line-1', result['branches'])


if __name__ == '__main__':
    unittest.main()

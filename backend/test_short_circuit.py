import unittest

from fastapi import HTTPException

from backend.main import ShortCircuitInput, calculate_short_circuit
from backend.test_study_samples import make_short_circuit_payload


class ShortCircuitTests(unittest.TestCase):
    def make_payload(self, **overrides):
        return ShortCircuitInput(**make_short_circuit_payload(**overrides).model_dump())

    def test_ansi_short_circuit_returns_standard_aware_fault_and_branch_results(self):
        result = calculate_short_circuit(self.make_payload())

        self.assertEqual(result['fault']['standard'], 'ansi')
        self.assertEqual(result['fault']['standard_label'], 'ANSI')
        self.assertEqual(result['fault']['current_type_label'], 'ANSI symmetrical RMS current')
        self.assertEqual(result['fault']['current_result_key'], 'ikss_ka')
        self.assertTrue(result['fault']['limitations'])
        self.assertEqual(result['fault']['voltage_factor_mode'], 'nominal_from_iec_max')
        self.assertAlmostEqual(result['fault']['applied_voltage_factor'], 1.1)
        self.assertAlmostEqual(result['fault']['current_scale'], 1 / 1.1, places=5)
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

    def test_short_circuit_requires_connected_source(self):
        with self.assertRaises(HTTPException) as context:
            calculate_short_circuit(self.make_payload(generators=[]))

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('requires at least one connected generator or utility source', context.exception.detail)

    def test_short_circuit_rejects_fault_bus_not_connected_to_source(self):
        with self.assertRaises(HTTPException) as context:
            calculate_short_circuit(
                self.make_payload(
                    buses=[
                        {'id': 'bus-1', 'name': 'Source', 'vn_kv': 11.0},
                        {'id': 'bus-2', 'name': 'Fault Bus', 'vn_kv': 11.0},
                        {'id': 'bus-3', 'name': 'Dead Bus', 'vn_kv': 11.0}
                    ],
                    lines=[
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
                    loads=[],
                    fault_bus_id='bus-3'
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn('not electrically connected to any generator or utility source', context.exception.detail)

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

    def test_ansi_and_iec_initial_symmetrical_results_are_not_silent_aliases(self):
        ansi_result = calculate_short_circuit(self.make_payload())
        iec_result = calculate_short_circuit(self.make_payload(standard='iec_60909'))

        self.assertLess(ansi_result['fault_bus']['current_ka'], iec_result['fault_bus']['current_ka'])
        self.assertLess(
            ansi_result['branches']['line-1']['contribution_ka'],
            iec_result['branches']['line-1']['contribution_ka']
        )
        self.assertIn('derived from the IEC 60909 max-case engine', ansi_result['fault']['limitations'][2])
        self.assertEqual(iec_result['fault']['limitations'], [])

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

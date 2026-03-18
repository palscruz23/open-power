import unittest

from fastapi import HTTPException

from backend.main import (
    calculate_arc_flash,
    calculate_load_flow,
    calculate_protection_coordination,
    calculate_short_circuit,
)
from backend.test_study_samples import (
    make_arc_flash_input,
    make_load_flow_input,
    make_protection_study_input,
    make_short_circuit_input,
)


class RepresentativeStudyVerificationTests(unittest.TestCase):
    def test_load_flow_sample_network(self):
        result = calculate_load_flow(make_load_flow_input())

        self.assertEqual(set(result['buses'].keys()), {'bus-1', 'bus-2'})
        self.assertGreater(result['lines']['line-1']['i_from_ka'], 0.0)
        self.assertGreater(result['lines']['line-1']['loading_percent'], 0.0)
        self.assertGreater(result['loads']['load-1']['current_ka'], 0.0)
        self.assertLess(result['buses']['bus-2']['vm_pu'], result['buses']['bus-1']['vm_pu'])

    def test_ansi_short_circuit_sample_network(self):
        result = calculate_short_circuit(make_short_circuit_input())

        self.assertEqual(result['fault']['standard'], 'ansi')
        self.assertEqual(result['fault']['current_result_key'], 'ikss_ka')
        self.assertGreater(result['fault_bus']['current_ka'], 0.0)
        self.assertGreater(result['branches']['line-1']['contribution_ka'], 0.0)
        self.assertTrue(result['fault']['limitations'])

    def test_iec_60909_short_circuit_sample_network(self):
        result = calculate_short_circuit(
            make_short_circuit_input(standard='iec_60909', current_type='thermal_equivalent')
        )

        self.assertEqual(result['fault']['standard'], 'iec_60909')
        self.assertEqual(result['fault']['current_result_key'], 'ith_ka')
        self.assertGreater(result['fault_bus']['current_ka'], 0.0)
        self.assertEqual(result['branches']['line-1']['result_key'], 'ith_ka')
        self.assertIsNotNone(result['branches']['line-1']['ith_ka'])

    def test_ansi_and_iec_short_circuit_sample_networks_report_different_duties(self):
        ansi_result = calculate_short_circuit(make_short_circuit_input())
        iec_result = calculate_short_circuit(make_short_circuit_input(standard='iec_60909'))

        self.assertLess(ansi_result['fault_bus']['current_ka'], iec_result['fault_bus']['current_ka'])
        self.assertLess(
            ansi_result['branches']['line-1']['contribution_ka'],
            iec_result['branches']['line-1']['contribution_ka']
        )
        self.assertEqual(ansi_result['fault']['voltage_factor_mode'], 'nominal_from_iec_max')
        self.assertEqual(iec_result['fault']['voltage_factor_mode'], 'iec_max')

    def test_protection_coordination_sample_network(self):
        result = calculate_protection_coordination(make_protection_study_input())

        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['summary']['device_count'], 2)
        self.assertEqual(result['summary']['curve_count'], 2)
        self.assertGreaterEqual(len(result['curves']), 2)
        self.assertTrue(all(curve['points'] for curve in result['curves']))
        self.assertIn('analysis', result)

    def test_arc_flash_sample_network(self):
        result = calculate_arc_flash(make_arc_flash_input())

        self.assertEqual(result['status'], 'completed')
        self.assertGreater(result['summary']['incident_energy_cal_cm2'], 0.0)
        self.assertGreater(result['summary']['arc_flash_boundary_mm'], 0.0)
        self.assertEqual(result['assumptions']['study_bus_id'], 'bus-2')
        self.assertEqual(result['guidance']['confidence']['level'], 'supported')
        self.assertTrue(result['guidance']['summary_label'])
        self.assertTrue(result['limitations'])

    def test_arc_flash_validation_rejects_missing_fixed_clearing_time(self):
        with self.assertRaises(HTTPException) as context:
            calculate_arc_flash(
                make_arc_flash_input(
                    fault_clearing={'mode': 'fixed_time', 'duration_s': None, 'device_id': None}
                )
            )

        self.assertIn('fixed clearing time', str(context.exception.detail).lower())


if __name__ == '__main__':
    unittest.main()

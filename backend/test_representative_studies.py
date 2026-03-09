import unittest

from backend.main import (
    calculate_load_flow,
    calculate_protection_coordination,
    calculate_short_circuit,
)
from backend.test_study_samples import (
    make_load_flow_payload,
    make_protection_payload,
    make_short_circuit_payload,
)


class RepresentativeStudyVerificationTests(unittest.TestCase):
    def test_load_flow_sample_network_returns_bus_line_and_load_results(self):
        result = calculate_load_flow(make_load_flow_payload())

        self.assertIn('bus-2', result['buses'])
        self.assertIn('line-1', result['lines'])
        self.assertIn('load-1', result['loads'])
        self.assertAlmostEqual(result['buses']['bus-1']['vm_pu'], 1.0, places=4)
        self.assertGreater(result['loads']['load-1']['current_ka'], 0.0)

    def test_ansi_short_circuit_sample_network_returns_fault_and_branch_contributions(self):
        result = calculate_short_circuit(make_short_circuit_payload())

        self.assertEqual(result['fault']['standard'], 'ansi')
        self.assertEqual(result['fault']['current_result_key'], 'ikss_ka')
        self.assertGreater(result['fault_bus']['current_ka'], 1.0)
        self.assertGreater(result['branches']['line-1']['contribution_ka'], 0.0)

    def test_iec_60909_short_circuit_sample_network_returns_thermal_current_metadata(self):
        result = calculate_short_circuit(
            make_short_circuit_payload(standard='iec_60909', current_type='thermal_equivalent')
        )

        self.assertEqual(result['fault']['standard'], 'iec_60909')
        self.assertEqual(result['fault']['current_result_key'], 'ith_ka')
        self.assertGreater(result['fault_bus']['current_ka'], 1.0)
        self.assertEqual(result['branches']['line-1']['result_key'], 'ith_ka')
        self.assertIsNotNone(result['branches']['line-1']['ith_ka'])

    def test_protection_coordination_sample_network_returns_curves_and_analysis(self):
        result = calculate_protection_coordination(make_protection_payload())

        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['summary']['device_count'], 2)
        self.assertEqual(result['summary']['curve_count'], 2)
        self.assertEqual(len(result['curves']), 2)
        self.assertTrue(all(curve['points'] for curve in result['curves']))
        self.assertIn('analysis', result)
        self.assertIn('warnings', result['analysis'])


if __name__ == '__main__':
    unittest.main()

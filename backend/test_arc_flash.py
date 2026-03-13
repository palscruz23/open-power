import unittest

from fastapi import HTTPException

from backend.main import calculate_arc_flash
from backend.test_study_samples import make_arc_flash_input, make_protection_study_input


class ArcFlashInputTests(unittest.TestCase):
    def test_arc_flash_calculates_incident_energy_for_fixed_time_assumptions(self):
        result = calculate_arc_flash(make_arc_flash_input())

        self.assertEqual(result['status'], 'completed')
        self.assertGreater(result['summary']['incident_energy_cal_cm2'], 0.0)
        self.assertGreater(result['summary']['arc_flash_boundary_mm'], 0.0)
        self.assertGreater(result['summary']['available_fault_current_ka'], 0.0)
        self.assertGreater(result['summary']['arcing_current_ka'], 0.0)
        self.assertEqual(result['assumptions']['study_bus_id'], 'bus-2')
        self.assertEqual(result['assumptions']['fault_clearing']['mode'], 'fixed_time')
        self.assertGreater(result['assumptions']['working_distance_mm'], 0.0)
        self.assertIn('calculation', result)
        self.assertEqual(result['guidance']['confidence']['level'], 'supported')
        self.assertIn('severity_band', result['guidance'])
        self.assertTrue(result['guidance']['summary_label'])

    def test_arc_flash_accepts_device_based_clearing_assumption(self):
        protection_payload = make_protection_study_input()
        arc_flash_payload = make_arc_flash_input(
            buses=[bus.model_dump() for bus in protection_payload.buses],
            lines=[line.model_dump() for line in protection_payload.lines],
            loads=[load.model_dump() for load in protection_payload.loads],
            generators=[generator.model_dump() for generator in protection_payload.generators],
            transformers=[transformer.model_dump() for transformer in protection_payload.transformers],
            protection_devices=[device.model_dump() for device in protection_payload.protection_devices],
            study_bus_id='bus-2',
            fault_clearing={'mode': 'protective_device', 'device_id': 'load-1', 'duration_s': None},
        )

        result = calculate_arc_flash(arc_flash_payload)

        self.assertEqual(result['assumptions']['fault_clearing']['device_id'], 'load-1')
        self.assertEqual(result['assumptions']['fault_clearing']['device_name'], 'Motor Relay')
        self.assertGreater(result['summary']['clearing_time_s'], 0.0)
        self.assertIn('Protection device', result['assumptions']['fault_clearing']['assumption_label'])
        self.assertEqual(result['guidance']['confidence']['level'], 'review')
        self.assertTrue(result['guidance']['cautions'])

    def test_arc_flash_withholds_ppe_guidance_for_open_air_equipment(self):
        result = calculate_arc_flash(
            make_arc_flash_input(equipment_class='switchboard', enclosure_type='open_air')
        )

        self.assertEqual(result['guidance']['confidence']['level'], 'review')
        self.assertIsNone(result['guidance']['ppe_category'])
        self.assertTrue(result['guidance']['unsupported_labels'])
        self.assertEqual(result['summary']['ppe_category'], None)

    def test_arc_flash_rejects_missing_fixed_clearing_time(self):
        with self.assertRaises(HTTPException) as context:
            calculate_arc_flash(
                make_arc_flash_input(fault_clearing={'mode': 'fixed_time', 'duration_s': None, 'device_id': None})
            )

        self.assertIn('fixed clearing time', str(context.exception.detail).lower())

    def test_arc_flash_rejects_unsupported_open_air_mcc_case(self):
        with self.assertRaises(HTTPException) as context:
            calculate_arc_flash(make_arc_flash_input(equipment_class='mcc', enclosure_type='open_air'))

        self.assertIn('enclosed equipment only', str(context.exception.detail).lower())


if __name__ == '__main__':
    unittest.main()

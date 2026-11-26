import unittest
from simulator import fee_pct_to_fraction, PoolConfig

class FeeUnitsTest(unittest.TestCase):
    def test_percent_conversion(self):
        self.assertAlmostEqual(fee_pct_to_fraction(0.25), 0.0025)
        self.assertAlmostEqual(fee_pct_to_fraction(1), 0.01)
        self.assertEqual(fee_pct_to_fraction(0), 0)
        for bad in (-1, 100, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                fee_pct_to_fraction(bad)
    def test_config_unit(self):
        self.assertAlmostEqual(fee_pct_to_fraction(PoolConfig().base_fee_pct), 0.0025)

from app.services import tutor

FACTS = [
    tutor.fact(1, "Measured motion (this app): 8.15 arcsec/yr, shift 20.3 pixels", "SolaraX"),
    tutor.fact(2, "AllWISE J085510.74-071442.5: W1 = 16.231, W2 = 13.704, W1-W2 = 2.53", "AllWISE"),
]


def test_numbers_in_facts_pass_and_citations_ignored():
    ans = "It moves 8.15 arcsec per year [F1]. Its W1-W2 color is 2.53 [F2]."
    clean, dropped, bad = tutor.check_numbers(ans, FACTS)
    assert dropped == 0 and clean == ans


def test_one_decimal_rounding_allowed_but_coarser_rounding_is_not():
    assert tutor.check_numbers("Its W1 is 16.23 [F2].", FACTS)[1] == 0     # 16.231 -> 16.23
    assert tutor.check_numbers("It jumps 20.3 pixels [F1].", FACTS)[1] == 0
    # Strict on purpose: 'about 20' when the fact says 20.3 is regenerated/dropped.
    assert tutor.check_numbers("It jumps about 20 pixels [F1].", FACTS)[1] == 1


def test_invented_number_drops_sentence():
    ans = "It is 7.3 light years away [F1]. It moves 8.15 arcsec per year [F1]."
    clean, dropped, bad = tutor.check_numbers(ans, FACTS)
    assert dropped == 1 and "7.3" in bad[0] and clean == "It moves 8.15 arcsec per year [F1]."


def test_fact_sheet_has_ids_and_sources():
    facts = tutor.fact_sheet({"simbad": {"name": "WISE J085510.83-071442.5", "otype": "BD*"},
                              "source": {"gaiaStatus": "dark"}})
    assert [f["id"] for f in facts][:3] == ["F1", "F2", "F3"]
    assert all(f["source"] for f in facts)

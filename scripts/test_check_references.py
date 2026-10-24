#!/usr/bin/env python3
"""Regression tests for check_references.py (Crossref DOI metadata matching)."""

import unittest

import scripts.check_references as cr

HINDS_REF = (
    "Hinds, P. J., & Mortensen, M. (2005). Understanding conflict in geographically "
    "distributed teams: The moderating effects of shared identity, shared context, and "
    "spontaneous communication. *Organization Science*, 16(3), 290–307. "
    "[https://doi.org/10.1287/orsc.1050.0122](https://doi.org/10.1287/orsc.1050.0122)"
)

HINDS_META = {
    "title": "Understanding Conflict in Geographically Distributed Teams: The Moderating "
    "Effects of Shared Identity, Shared Context, and Spontaneous Communication",
    "authors": ["Hinds", "Mortensen"],
    "year": 2005,
}

# What 10.1287/orsc.1050.0133 actually resolves to.
WEICK_META = {
    "title": "Organizing and the Process of Sensemaking",
    "authors": ["Weick", "Sutcliffe", "Obstfeld"],
    "year": 2005,
}

LESSON_BODY = f"""
# Remote Work

Teams need shared context (see https://doi.org/10.9999/not-a-reference).

## References

- {HINDS_REF}
- Brooks, F. P. (1975). *The Mythical Man-Month*. Addison-Wesley.
"""


class ExtractReferencesTest(unittest.TestCase):
    def test_extracts_doi_from_markdown_link_in_references_section(self):
        refs = cr.extract_references(LESSON_BODY)
        dois = [r.doi for r in refs if r.doi]
        self.assertEqual(dois, ["10.1287/orsc.1050.0122"])

    def test_ignores_dois_outside_references_section(self):
        refs = cr.extract_references(LESSON_BODY)
        self.assertNotIn("10.9999/not-a-reference", [r.doi for r in refs])

    def test_parses_year_and_first_author(self):
        ref = cr.extract_references(LESSON_BODY)[0]
        self.assertEqual(ref.year, 2005)
        self.assertEqual(ref.first_author, "Hinds")

    def test_reference_without_doi_is_kept_with_no_doi(self):
        refs = cr.extract_references(LESSON_BODY)
        self.assertEqual(len(refs), 2)
        self.assertIsNone(refs[1].doi)


class CompareTest(unittest.TestCase):
    def test_matching_metadata_has_no_errors(self):
        ref = cr.extract_references(LESSON_BODY)[0]
        errors, warnings = cr.compare(ref, HINDS_META)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_doi_pointing_to_a_different_paper_is_an_error(self):
        ref = cr.extract_references(LESSON_BODY)[0]
        errors, _ = cr.compare(ref, WEICK_META)
        self.assertTrue(any("title" in e for e in errors), errors)
        self.assertTrue(any("author" in e for e in errors), errors)

    def test_year_off_by_one_is_only_a_warning(self):
        ref = cr.extract_references(LESSON_BODY)[0]
        errors, warnings = cr.compare(ref, {**HINDS_META, "year": 2004})
        self.assertEqual(errors, [])
        self.assertTrue(any("year" in w for w in warnings), warnings)

    def test_year_off_by_more_than_one_is_an_error(self):
        ref = cr.extract_references(LESSON_BODY)[0]
        errors, _ = cr.compare(ref, {**HINDS_META, "year": 1997})
        self.assertTrue(any("year" in e for e in errors), errors)


class LookupTest(unittest.TestCase):
    def test_cached_doi_does_not_call_the_network(self):
        def fetcher(doi):
            raise AssertionError("network called for a cached DOI")

        cache = {"10.1287/orsc.1050.0122": HINDS_META}
        self.assertEqual(cr.lookup("10.1287/orsc.1050.0122", cache, fetcher), HINDS_META)

    def test_fetched_metadata_is_stored_in_cache(self):
        cache = {}
        cr.lookup("10.1287/orsc.1050.0122", cache, lambda doi: HINDS_META)
        self.assertEqual(cache["10.1287/orsc.1050.0122"], HINDS_META)


class CheckBodyTest(unittest.TestCase):
    def test_network_failure_is_a_warning_not_an_error(self):
        def fetcher(doi):
            raise cr.ReferenceLookupError("HTTP 429")

        errors, warnings = cr.check_body(LESSON_BODY, {}, fetcher)
        self.assertEqual(errors, [])
        self.assertTrue(any("429" in w for w in warnings), warnings)

    def test_doi_unknown_to_crossref_is_an_error(self):
        def fetcher(doi):
            raise cr.DoiNotFound(doi)

        errors, _ = cr.check_body(LESSON_BODY, {}, fetcher)
        self.assertTrue(any("not found" in e for e in errors), errors)

    def test_wrong_doi_is_reported_as_an_error(self):
        errors, _ = cr.check_body(LESSON_BODY, {}, lambda doi: WEICK_META)
        self.assertTrue(any("10.1287/orsc.1050.0122" in e for e in errors), errors)


class ParseCrossrefTest(unittest.TestCase):
    def test_parses_title_authors_and_year_from_crossref_message(self):
        message = {
            "title": ["Organizing and the Process of Sensemaking"],
            "author": [{"family": "Weick"}, {"family": "Sutcliffe"}],
            "issued": {"date-parts": [[2005, 8]]},
        }
        self.assertEqual(
            cr.parse_crossref(message),
            {
                "title": "Organizing and the Process of Sensemaking",
                "authors": ["Weick", "Sutcliffe"],
                "year": 2005,
            },
        )


if __name__ == "__main__":
    unittest.main()

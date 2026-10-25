#!/usr/bin/env python3
"""Regression tests for check_references.py (Crossref DOI metadata matching)."""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

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

    def test_parses_year_and_keeps_full_text_for_author_matching(self):
        ref = cr.extract_references(LESSON_BODY)[0]
        self.assertEqual(ref.year, 2005)
        self.assertEqual(ref.text, HINDS_REF)

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

    def test_short_surname_inside_a_longer_cited_surname_is_an_error(self):
        ref = cr.extract_references(
            "## References\n\n- Lindqvist, K. (2005). Understanding conflict in geographically "
            "distributed teams. https://doi.org/10.1234/x\n"
        )[0]
        for surname in ("Li", "Qvist"):  # prefix and suffix of the cited surname
            with self.subTest(surname=surname):
                meta = {"title": "Understanding conflict in geographically distributed teams",
                        "authors": [surname], "year": 2005}
                errors, _ = cr.compare(ref, meta)
                self.assertTrue(any("first author" in e for e in errors), errors)

    def test_title_first_reference_matches_author_later_in_the_text(self):
        ref = cr.extract_references(
            "## References\n\n- [Rigorous benchmarking in reasonable time](https://doi.org/10.1234/kj), "
            "Kalibera and Jones, ISMM 2013.\n"
        )[0]
        meta = {"title": "Rigorous benchmarking in reasonable time", "authors": ["Kalibera", "Jones"], "year": 2013}
        self.assertEqual(cr.compare(ref, meta), ([], []))
        errors, _ = cr.compare(ref, {**meta, "authors": ["Blackburn"]})
        self.assertTrue(any("first author" in e for e in errors), errors)

    def test_sharp_s_in_crossref_surname_matches_ss_in_citation(self):
        ref = cr.extract_references(
            "## References\n\n- Weiss, M. (2005). Understanding conflict in geographically "
            "distributed teams. https://doi.org/10.1234/x\n"
        )[0]
        meta = {"title": "Understanding conflict in geographically distributed teams",
                "authors": ["Weiß"], "year": 2005}
        self.assertEqual(cr.compare(ref, meta), ([], []))

    def test_multi_word_and_accented_surnames_match_their_crossref_form(self):
        ref = cr.extract_references(
            "## References\n\n- van der Aalst, W. M. P., & García-Molina, H. (2005). "
            "Understanding conflict in geographically distributed teams. https://doi.org/10.1234/x\n"
        )[0]
        meta = {"title": "Understanding conflict in geographically distributed teams",
                "authors": ["van der Aalst", "Garcia-Molina"], "year": 2005}
        self.assertEqual(cr.compare(ref, meta), ([], []))

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

    def check_via_crossref(self, doi, responses):
        """Run check_body on one reference, answering Crossref requests from `responses`.

        `responses` maps a URL suffix ("" for works/<doi>, "/agency") to a JSON body,
        or to an exception the HTTP layer would raise.
        """
        base = cr.CROSSREF_WORKS + doi

        def get_json(url):
            answer = responses[url[len(base):]]
            if isinstance(answer, Exception):
                raise answer
            return answer

        body = f"## References\n\n- Vaswani, A., et al. (2017). Attention is all you need. https://doi.org/{doi}\n"
        cache = {}
        errors, warnings = cr.check_body(body, cache, lambda d: cr.fetch_crossref(d, get_json=get_json))
        return errors, warnings, cache

    def test_datacite_doi_is_a_warning_naming_its_registry(self):
        # Crossref's agency endpoint answers this way for 10.48550/arXiv.1706.03762.
        agency = {"message": {"DOI": "10.48550/arxiv.1706.03762", "agency": {"id": "datacite", "label": "DataCite"}}}
        errors, warnings, _ = self.check_via_crossref(
            "10.48550/arxiv.1706.03762", {"": cr.HttpNotFound(), "/agency": agency})
        self.assertEqual(errors, [])
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("10.48550/arxiv.1706.03762", warnings[0])
        self.assertIn("datacite", warnings[0])
        self.assertIn("non-Crossref DOI", warnings[0])

    def test_doi_no_registry_knows_is_an_error(self):
        # A mistyped DOI: both works/<doi> and works/<doi>/agency return 404.
        errors, warnings, _ = self.check_via_crossref(
            "10.1145/2464157.2464169999", {"": cr.HttpNotFound(), "/agency": cr.HttpNotFound()})
        self.assertEqual(warnings, [])
        self.assertEqual(errors, ["10.1145/2464157.2464169999: DOI not found in any registry"])

    def test_crossref_agency_without_works_record_is_a_lookup_warning(self):
        agency = {"message": {"agency": {"id": "crossref", "label": "Crossref"}}}
        errors, warnings, _ = self.check_via_crossref(
            "10.1234/x", {"": cr.HttpNotFound(), "/agency": agency})
        self.assertEqual(errors, [])
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("lookup failed", warnings[0])

    def test_transport_error_on_works_lookup_is_reported_unchanged(self):
        errors, warnings, cache = self.check_via_crossref("10.1234/x", {"": cr.ReferenceLookupError("HTTP 500")})
        self.assertEqual(errors, [])
        self.assertEqual(warnings, ["10.1234/x: lookup failed (HTTP 500)"])
        self.assertEqual(cache, {})

    def test_malformed_crossref_body_is_a_lookup_warning_and_not_cached(self):
        cases = {
            "empty works body": {"": {}},
            "works message not an object": {"": {"message": "oops"}},
            "agency message without agency": {"": cr.HttpNotFound(), "/agency": {"message": {}}},
            "agency field null": {"": cr.HttpNotFound(), "/agency": {"message": {"agency": None}}},
        }
        for name, responses in cases.items():
            with self.subTest(name):
                errors, warnings, cache = self.check_via_crossref("10.1234/x", responses)
                self.assertEqual(errors, [])
                self.assertEqual(len(warnings), 1, warnings)
                self.assertTrue(warnings[0].startswith("10.1234/x: lookup failed (malformed Crossref response"),
                                warnings)
                self.assertEqual(cache, {})

    def test_transport_error_on_agency_lookup_is_not_a_pass(self):
        errors, warnings, cache = self.check_via_crossref(
            "10.1234/x", {"": cr.HttpNotFound(), "/agency": cr.ReferenceLookupError("timed out")})
        self.assertEqual(errors, [])
        self.assertEqual(warnings, ["10.1234/x: lookup failed (timed out)"])
        self.assertEqual(cache, {})

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


class MainExitCodeTest(unittest.TestCase):
    def run_main(self, fetcher):
        with tempfile.TemporaryDirectory() as tmp:
            lesson = Path(tmp) / "lesson.mdx"
            lesson.write_text(LESSON_BODY, encoding="utf-8")
            argv = [str(lesson), "--cache", str(Path(tmp) / "crossref.json"), "--delay", "0"]
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as exit_:
                cr.main(argv, fetcher=fetcher)
        return exit_.exception.code

    def test_errors_exit_1(self):
        self.assertEqual(self.run_main(lambda doi: WEICK_META), 1)

    def test_warnings_only_exit_0(self):
        self.assertEqual(self.run_main(lambda doi: {**HINDS_META, "year": 2004}), 0)

    def test_clean_run_exits_0(self):
        self.assertEqual(self.run_main(lambda doi: HINDS_META), 0)


if __name__ == "__main__":
    unittest.main()

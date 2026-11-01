#!/usr/bin/env python3
"""Check that DOIs in lesson References sections point to the cited work.

A DOI can resolve and still name a different paper. This script compares each
DOI's Crossref record (title, first author, year) with the reference text it
sits in. Crossref results are cached so repeated runs stay off the network.
"""
import argparse
import http.client
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
LESSONS_DIR = ROOT / "src" / "content" / "lessons"
DEFAULT_CACHE = ROOT / ".cache" / "crossref.json"
CROSSREF_WORKS = "https://api.crossref.org/works/"

REFERENCE_HEADING_RE = re.compile(
    r"^##+\s+(references|sources|bibliography|further reading)\b.*$",
    re.IGNORECASE | re.MULTILINE,
)
NEXT_HEADING_RE = re.compile(r"^#{1,2}\s+", re.MULTILINE)
LIST_ITEM_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(.*)$", re.MULTILINE)
DOI_RE = re.compile(r"(?:doi\.org/|doi:\s*)(10\.\d{4,9}/[^\s\])>]+)", re.IGNORECASE)
YEAR_RE = re.compile(r"\((\d{4})[a-z]?[,)]")
STOP_WORDS = {"the", "and", "for", "with", "from", "into", "that", "this", "their", "about"}
TITLE_MATCH_THRESHOLD = 0.8


class ReferenceLookupError(Exception):
    """The lookup could not be completed (network error, rate limit)."""


class DoiNotFound(ReferenceLookupError):
    """No registry knows the DOI: Crossref has no record and no registration agency."""


class NonCrossrefDoi(ReferenceLookupError):
    """The DOI is registered with another agency, e.g. DataCite for arXiv and Zenodo."""

    def __init__(self, doi, agency):
        super().__init__(f"{doi} is registered with {agency}")
        self.agency = agency


class HttpNotFound(Exception):
    """A Crossref API request returned 404."""


@dataclass
class Reference:
    text: str
    doi: Optional[str]
    year: Optional[int]


def normalize(text):
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text.casefold())  # casefold also folds ß to ss


def extract_references(body):
    heading = REFERENCE_HEADING_RE.search(body)
    if not heading:
        return []
    section = body[heading.end():]
    next_heading = NEXT_HEADING_RE.search(section)
    if next_heading:
        section = section[:next_heading.start()]

    refs = []
    for item in LIST_ITEM_RE.findall(section):
        doi_match = DOI_RE.search(item)
        doi = doi_match.group(1).rstrip(".,;").lower() if doi_match else None
        year_match = YEAR_RE.search(item)
        refs.append(Reference(
            text=item,
            doi=doi,
            year=int(year_match.group(1)) if year_match else None,
        ))
    return refs


def compare(ref, meta):
    errors, warnings = [], []
    ref_text = normalize(ref.text)
    ref_words = set(ref_text.split())

    title_words = [w for w in normalize(meta["title"]).split() if len(w) >= 4 and w not in STOP_WORDS]
    if title_words:
        matched = sum(w in ref_words for w in title_words) / len(title_words)
        if matched < TITLE_MATCH_THRESHOLD:
            errors.append(f"title mismatch ({matched:.0%} of words): Crossref has '{meta['title']}'")

    authors = meta.get("authors") or []
    if authors:
        # Whole-word search over the whole reference, so title-first styles still match.
        surname = re.escape(normalize(authors[0]).strip())
        if not re.search(rf"\b{surname}\b", ref_text):
            errors.append(f"first author mismatch: Crossref has '{authors[0]}'")

    if ref.year and meta.get("year"):
        diff = abs(ref.year - meta["year"])
        if diff == 1:
            warnings.append(f"year differs by one: cited {ref.year}, Crossref {meta['year']}")
        elif diff > 1:
            errors.append(f"year mismatch: cited {ref.year}, Crossref {meta['year']}")
    return errors, warnings


def lookup(doi, cache, fetcher):
    key = doi.lower()
    if key not in cache:
        cache[key] = fetcher(key)
    return cache[key]


def check_body(body, cache, fetcher):
    errors, warnings = [], []
    for ref in extract_references(body):
        if not ref.doi:
            continue
        try:
            meta = lookup(ref.doi, cache, fetcher)
        except DoiNotFound:
            errors.append(f"{ref.doi}: DOI not found in any registry")
            continue
        except NonCrossrefDoi as exc:
            warnings.append(f"{ref.doi}: registered with {exc.agency}, not Crossref (non-Crossref DOI); metadata not checked")
            continue
        except ReferenceLookupError as exc:
            warnings.append(f"{ref.doi}: lookup failed ({exc})")
            continue
        ref_errors, ref_warnings = compare(ref, meta)
        errors += [f"{ref.doi}: {e}" for e in ref_errors]
        warnings += [f"{ref.doi}: {w}" for w in ref_warnings]
    return errors, warnings


def parse_crossref(message):
    title = (message.get("title") or [""])[0]
    authors = [a["family"] for a in message.get("author", []) if a.get("family")]
    parts = message.get("issued", {}).get("date-parts") or [[None]]
    return {"title": title, "authors": authors, "year": parts[0][0]}


def get_crossref_json(url, retries=3, backoff=2.0):
    request = urllib.request.Request(
        url, headers={"User-Agent": "LibreUni-reference-check (https://github.com/LibreUni/LibreUni)"}
    )
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise HttpNotFound(url) from exc
            if exc.code == 429 and attempt < retries:
                time.sleep(backoff * 2 ** attempt)
                continue
            raise ReferenceLookupError(f"HTTP {exc.code}") from exc
        except (OSError, http.client.HTTPException, ValueError) as exc:
            raise ReferenceLookupError(str(exc)) from exc
    raise ReferenceLookupError("retries exhausted")


# What indexing or .get() raises on a Crossref body of an unexpected shape.
MALFORMED_BODY_ERRORS = (KeyError, TypeError, AttributeError)


def fetch_crossref(doi, get_json=get_crossref_json):
    url = CROSSREF_WORKS + urllib.parse.quote(doi, safe="/")
    try:
        return parse_crossref(get_json(url)["message"])
    except HttpNotFound:
        pass
    except MALFORMED_BODY_ERRORS as exc:
        raise ReferenceLookupError(f"malformed Crossref response: {exc!r}") from exc
    # Not in Crossref: ask which agency registered it, so a typo is told apart from a DataCite DOI.
    try:
        agency = get_json(url + "/agency")["message"]["agency"]["id"]
    except HttpNotFound:
        raise DoiNotFound(doi) from None
    except MALFORMED_BODY_ERRORS as exc:
        raise ReferenceLookupError(f"malformed Crossref response: {exc!r}") from exc
    if agency == "crossref":
        raise ReferenceLookupError("Crossref lists the DOI but returned no record")
    raise NonCrossrefDoi(doi, agency)


def throttled(fetcher, delay):
    def fetch(doi):
        time.sleep(delay)
        return fetcher(doi)
    return fetch


def lesson_files(targets):
    if not targets:
        return sorted(LESSONS_DIR.glob("**/*.mdx"))
    files = []
    for target in targets:
        path = Path(target)
        if not path.exists():
            path = LESSONS_DIR / target
        files += sorted(path.glob("**/*.mdx")) if path.is_dir() else [path]
    return files


def main(argv=None, fetcher=None):
    parser = argparse.ArgumentParser(description="Check lesson DOIs against Crossref metadata.")
    parser.add_argument("targets", nargs="*", help="Lesson files, course folders, or course ids (default: all lessons)")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="Crossref cache file")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between Crossref requests")
    args = parser.parse_args(argv)

    cache = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache.exists() else {}
    fetcher = fetcher or throttled(fetch_crossref, args.delay)

    total_errors = total_warnings = 0
    for path in lesson_files(args.targets):
        errors, warnings = check_body(path.read_text(encoding="utf-8"), cache, fetcher)
        if errors or warnings:
            print(f"\n[REFERENCES] {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
            for e in errors:
                print(f"  - ERROR: {e}")
            for w in warnings:
                print(f"  - WARNING: {w}")
        total_errors += len(errors)
        total_warnings += len(warnings)

    args.cache.parent.mkdir(parents=True, exist_ok=True)
    args.cache.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")
    print(f"\nReference check: {total_errors} errors, {total_warnings} warnings.")
    sys.exit(1 if total_errors else 0)


if __name__ == "__main__":
    main()

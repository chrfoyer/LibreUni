import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import verify_lessons as vl  # noqa: E402

LESSON = """---
title: Example
course: example
description: An example lesson.
---
# Example

{phrase} the topic.

## References

- Author, A. (2020). *A Book*. Publisher.
"""


def errors_for(phrase):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "lesson.mdx"
        path.write_text(LESSON.format(phrase=phrase), encoding="utf-8")
        errors, _, _ = vl.verify_lesson(path)
    return errors


class BannedPhraseTest(unittest.TestCase):
    def test_straight_apostrophe_banned_phrase_is_an_error(self):
        self.assertTrue(any("banned" in e for e in errors_for("Let's dive in to")))

    def test_curly_apostrophe_banned_phrase_is_an_error(self):
        self.assertTrue(any("banned" in e for e in errors_for("Let’s dive in to")))

    def test_word_containing_banned_word_is_not_an_error(self):
        self.assertFalse(any("banned" in e for e in errors_for("An unwelcome result shapes")))


if __name__ == "__main__":
    unittest.main()

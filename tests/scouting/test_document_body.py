"""Keep heading discovery separate from evidence that article body text was read."""
import unittest
from scouting.documents import extract_document

SOURCE = {'id': 'body-fixture', 'allowedHosts': ['example.test'],
          'probeMode': 'public_metadata_only'}

class ArticleBodyTests(unittest.TestCase):
    def inspect(self, markup):
        return extract_document(markup.encode(), 'https://example.test/release', SOURCE,
                                content_type='text/html', retain_text=False)

    def test_two_headings_do_not_establish_article_body(self):
        result = self.inspect('<article><h1>A company announcement</h1><h2>A longer subtitle</h2></article>')
        self.assertEqual(len(result['passages']), 2)
        self.assertEqual(result['bodyPassageCount'], 0)
        self.assertEqual(result['bodyCharacters'], 0)
        self.assertEqual(result['status'], 'html_body_not_established')
        self.assertFalse(result['textTraversalComplete'])
        self.assertIn('article_body_not_established', result['pendingReasons'])
        self.assertFalse(result['publishable'])

    def test_body_is_counted_separately_without_retaining_text(self):
        body = 'Synthetic company information in an actual paragraph.'
        result = self.inspect(f'<article><h1>Announcement</h1><p>{body}</p></article>')
        self.assertEqual(len(result['passages']), 2)
        self.assertEqual(result['bodyPassageCount'], 1)
        self.assertEqual(result['bodyCharacters'], len(body))
        self.assertEqual(result['status'], 'html_text_extracted')
        self.assertTrue(result['textTraversalComplete'])
        self.assertFalse(result['textRetained'])
        self.assertTrue(all('text' not in p for p in result['passages']))
        self.assertFalse(result['semanticCompletenessVerified'])

if __name__ == '__main__':
    unittest.main()

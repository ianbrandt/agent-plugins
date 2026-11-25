import os
import tempfile
import unittest

from warehouse.config import ConfigError, SyncConfig, load_config


class LoadConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "sync.ini")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(text)

    def test_reads_the_sync_section(self):
        self.write("[sync]\nfeed_url = http://wms.example/feed?x=%20\npage_size = 200\npoll_interval = 5\n")
        config = load_config(self.path, environ={})
        self.assertEqual(config.feed_url, "http://wms.example/feed?x=%20")
        self.assertEqual(config.page_size, 200)
        self.assertEqual(config.poll_interval, 5.0)
        self.assertEqual(config.batch_size, SyncConfig.batch_size)

    def test_environment_overrides_the_file(self):
        self.write("[sync]\nfeed_path = export.jsonl\nbatch_size = 50\n")
        config = load_config(self.path, environ={"WAREHOUSE_BATCH_SIZE": "25"})
        self.assertEqual(config.batch_size, 25)

    def test_unknown_setting(self):
        self.write("[sync]\nfeed_path = export.jsonl\npagesize = 10\n")
        with self.assertRaises(ConfigError):
            load_config(self.path, environ={})

    def test_needs_exactly_one_feed(self):
        with self.assertRaises(ConfigError):
            load_config(environ={})
        with self.assertRaises(ConfigError):
            load_config(environ={"WAREHOUSE_FEED_PATH": "e.jsonl", "WAREHOUSE_FEED_URL": "http://wms.example"})

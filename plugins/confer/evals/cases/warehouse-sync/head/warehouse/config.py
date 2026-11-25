"""Settings for sync, from an INI file and the environment."""

from __future__ import annotations

import configparser
import os
from dataclasses import dataclass, fields
from typing import Mapping

ENV_PREFIX = "WAREHOUSE_"

_INTS = frozenset({"page_size", "batch_size", "retry_attempts"})
_FLOATS = frozenset({"poll_interval", "max_poll_interval", "retry_base_delay", "retry_max_delay"})


class ConfigError(ValueError):
    """A setting is missing or invalid."""


@dataclass(frozen=True)
class SyncConfig:
    """Sync settings. Intervals and delays are in seconds."""

    db_path: str = "stock.db"
    feed_name: str = "main"
    feed_url: str | None = None
    feed_path: str | None = None
    page_size: int = 500
    batch_size: int = 100
    poll_interval: float = 30.0
    max_poll_interval: float = 300.0
    retry_attempts: int = 5
    retry_base_delay: float = 0.5
    retry_max_delay: float = 30.0
    dead_letter_path: str | None = None

    def validate(self) -> "SyncConfig":
        if (self.feed_url is None) == (self.feed_path is None):
            raise ConfigError("set exactly one of feed_url and feed_path")
        for name in sorted(_INTS):
            if getattr(self, name) < 1:
                raise ConfigError(f"{name} must be at least 1")
        if self.batch_size > self.page_size:
            raise ConfigError("batch_size cannot be larger than page_size")
        if self.poll_interval <= 0:
            raise ConfigError("poll_interval must be positive")
        if self.max_poll_interval < self.poll_interval:
            raise ConfigError("max_poll_interval cannot be shorter than poll_interval")
        if self.retry_base_delay < 0:
            raise ConfigError("retry_base_delay cannot be negative")
        if self.retry_max_delay < self.retry_base_delay:
            raise ConfigError("retry_max_delay cannot be shorter than retry_base_delay")
        return self


def _coerce(name: str, raw: str):
    if name in _INTS:
        kind = int
    elif name in _FLOATS:
        kind = float
    else:
        return raw.strip() or None
    try:
        return kind(raw)
    except ValueError:
        raise ConfigError(f"{name}: {raw!r} is not a valid {kind.__name__}") from None


def load_config(path=None, environ: Mapping[str, str] | None = None) -> SyncConfig:
    """Read the [sync] section of an INI file, then apply WAREHOUSE_* environment overrides.

    The variable for a setting is its name in upper case after the prefix, as in
    WAREHOUSE_PAGE_SIZE for page_size.
    """
    environ = os.environ if environ is None else environ
    known = {f.name for f in fields(SyncConfig)}
    values: dict[str, object] = {}
    if path is not None:
        parser = configparser.ConfigParser(interpolation=None)
        if not parser.read(path, encoding="utf-8"):
            raise ConfigError(f"cannot read {path}")
        if parser.has_section("sync"):
            for key, raw in parser.items("sync"):
                if key not in known:
                    raise ConfigError(f"unknown setting {key!r} in {path}")
                values[key] = _coerce(key, raw)
    for name in known:
        raw = environ.get(ENV_PREFIX + name.upper())
        if raw is not None:
            values[name] = _coerce(name, raw)
    return SyncConfig(**values).validate()

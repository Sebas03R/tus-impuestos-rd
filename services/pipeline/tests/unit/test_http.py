import httpx
import pytest
import respx

from tirds.config import Settings
from tirds.http import DisallowedHost, PoliteClient, SourceUnavailable, TokenBucket

BASE = "https://datosabiertos.dgcp.gob.do/api-dgcp/v1"


def client(**kw):
    sleeps: list[float] = []
    c = PoliteClient(Settings(REQUESTS_PER_MINUTE=6000, **kw), sleep=sleeps.append, max_retries=3, base_backoff_s=1)
    return c, sleeps


@respx.mock
def test_retries_then_succeeds_with_backoff():
    route = respx.get(f"{BASE}/procesos").mock(
        side_effect=[httpx.Response(500), httpx.Response(429), httpx.Response(200, json={"ok": 1})]
    )
    c, sleeps = client()
    assert c.get_json(f"{BASE}/procesos") == {"ok": 1}
    assert route.call_count == 3 and len(sleeps) == 2 and sleeps[1] > sleeps[0] * 0.5


@respx.mock
def test_gives_up_after_max_retries():
    respx.get(f"{BASE}/procesos").mock(return_value=httpx.Response(503))
    c, _ = client()
    with pytest.raises(SourceUnavailable):
        c.get_json(f"{BASE}/procesos")


def test_ssrf_host_whitelist():
    c, _ = client()
    with pytest.raises(DisallowedHost):
        c.request("http://169.254.169.254/latest/meta-data")
    with pytest.raises(DisallowedHost):
        c.request("https://evil.example.com/x")


@respx.mock
def test_redirect_outside_whitelist_is_blocked():
    respx.get(f"{BASE}/x").mock(return_value=httpx.Response(302, headers={"location": "https://evil.example.com/"}))
    c, _ = client()
    with pytest.raises(DisallowedHost):
        c.request(f"{BASE}/x")


@respx.mock
def test_download_size_limit():
    respx.get(f"{BASE}/big").mock(return_value=httpx.Response(200, content=b"x" * 2048))
    c, _ = client(MAX_DOWNLOAD_BYTES=1024)
    with pytest.raises(SourceUnavailable):
        c.request(f"{BASE}/big")


@respx.mock
def test_decimal_parsing_keeps_precision():
    respx.get(f"{BASE}/n").mock(return_value=httpx.Response(200, text='{"v": 12345678901234.56}'))
    c, _ = client()
    from decimal import Decimal

    assert c.get_json(f"{BASE}/n")["v"] == Decimal("12345678901234.56")


@respx.mock
def test_pauses_when_rate_limit_nearly_exhausted():
    respx.get(f"{BASE}/p").mock(
        return_value=httpx.Response(200, json={}, headers={"x-ratelimit-remaining": "1", "x-ratelimit-reset": "12"})
    )
    c, sleeps = client()
    c.get_json(f"{BASE}/p")
    assert sleeps and sleeps[-1] == 13


def test_token_bucket_waits_when_empty():
    now = [0.0]
    waits: list[float] = []

    def sleep(s: float) -> None:
        waits.append(s)
        now[0] += s

    b = TokenBucket(60, sleep=sleep, clock=lambda: now[0])
    for _ in range(61):
        b.acquire()
    assert waits and abs(sum(waits) - 1.0) < 0.01

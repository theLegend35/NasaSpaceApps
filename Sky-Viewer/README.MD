# SPHEREx Sky Viewer

Next.js interface and FastAPI lookup service for SPHEREx observations available through NASA/IPAC IRSA.

## Start the app

Use three terminals from the `Sky-Viewer` directory.

Start Redis in the first terminal:

```sh
redis-server --bind 127.0.0.1 --port 6379 --dir /tmp --dbfilename spherex-redis.rdb --appendonly yes --appendfilename spherex-redis.aof
```

Install and start the API in the second terminal:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.lookup:app --reload
```

Install and start the Next.js app in the third terminal:

```sh
npm install
npm run dev
```

Open http://localhost:3000. The frontend proxies API requests to `http://127.0.0.1:8000`. Set `LOOKUP_API_URL` if the FastAPI server runs at another address.

Redis seeds WISE 0855, Barnard's Star, Epsilon Indi B, RW Aurigae, and R Draconis as selectable targets. Moving-star preset coordinates are propagated to epoch 2025. Redis caches coordinate lookups for 24 hours and image previews for 30 days. Image footprints are returned with each lookup and drawn on both sky views. Set `REDIS_URL` to use another Redis instance.

**Locate in sky** only updates the selected coordinates and checks Redis; it does not contact the archive. Use **Load observations** to run TAP/SIA discovery for a cache miss.

## API

`GET /point?ra=210.80227&dec=54.34895` returns matching observations and per-pixel spectral measurements synchronously. The app uses `POST /point/jobs` followed by `GET /point/jobs/{job_id}` to track long lookups without holding a browser request open. Optional lookup parameters are `size` (cutout size in degrees) and `detector` (1-6).

Image discovery tries IRSA TAP first for the latest ingested observations, with a 45-second request timeout, then falls back to SIA for the DR1 and QR3 wide/deep collections. SIA may lag new data ingestion by about a day; the selected source is shown with the results. The default cutout size is 0.1 degrees to show more spatial context. The app creates an enlarged grayscale preview and overlays the selected coordinate without altering image pixels. A single-band false-color palette is available for viewing contrast, but it does not represent natural RGB colors. The original `index.html` remains the exported design mockup.

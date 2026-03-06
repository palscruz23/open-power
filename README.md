# OpenPower Studio (Local MVP)

Open Power Studio is a cost-effective local web app for creating small power networks (up to 20 buses) and running:

- Load-flow analysis
- Short-circuit analysis

The stack is intentionally simple for low cost and easy local operation:

- **Frontend:** Vite + React + React Flow (drag/drop single-page app)
- **Backend:** FastAPI + pandapower

## Project structure

- `frontend/` — Vite React UI for drawing and editing network
- `backend/` — FastAPI endpoints for calculations

## Run locally

### 1) Backend

> **Python version:** use **Python 3.12** for now.
> `pandapower==2.14.10` depends on `scipy<1.14`, and SciPy wheels for Python 3.13 on Windows are not available for that range.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Windows (PowerShell) example with Python 3.12:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 2) Frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173

## Components available in the canvas

- **Bus**
- **Motor Load**
- **Resistive Load**
- **Generator**
- **Utility Grid**
- **Transformer**

### Component behavior in studies

- Motor load and resistive load are both sent as backend loads.
- Utility grid is sent as a generator source (slack/ext-grid handling remains in backend).
- Transformer nodes are sent to backend as explicit transformer elements (HV/LV buses + nameplate impedance).

## Notes

- Maximum of **20 buses** is enforced on both frontend and backend.
- In this MVP, line parameters are fixed defaults when connecting one bus to another (can be made editable next).
- Loads and generators are attached by drawing an edge to a bus.
- If no generator is attached, backend auto-creates a slack source on the first bus.

## API endpoints

- `GET /health`
- `POST /api/calculate/load-flow`
- `POST /api/calculate/short-circuit`

Payload model:

```json
{
  "buses": [{ "id": "bus-1", "name": "Bus 1", "vn_kv": 33 }],
  "lines": [
    {
      "id": "line-1",
      "from_bus": "bus-1",
      "to_bus": "bus-2",
      "length_km": 1,
      "r_ohm_per_km": 0.642,
      "x_ohm_per_km": 0.083,
      "c_nf_per_km": 210,
      "max_i_ka": 0.3
    }
  ],
  "loads": [{ "id": "load-1", "bus": "bus-2", "p_mw": 4, "q_mvar": 1.5 }],
  "generators": [{ "id": "gen-1", "bus": "bus-1", "p_mw": 5, "vm_pu": 1.02 }]
}
```

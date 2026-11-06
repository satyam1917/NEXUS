"""Convert NEXUS_Updated_Product_Data_Annex.xlsx -> data/nexus-data.json.

The workbook is the source of truth and is opened read-only; nothing is written back to it.
The browser app loads the JSON and re-validates it (member IDs, recalculated scores, task count).

Usage:
    pip install openpyxl
    python scripts/build_data.py data/NEXUS_Updated_Product_Data_Annex.xlsx
"""
import hashlib
import json
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "NEXUS_Updated_Product_Data_Annex.xlsx"

SHEETS = {
    "Start Here": None,  # two-column key/value sheet without a header row
    "Patient 360": ["Member ID", "Name", "Age", "Programme", "Conditions", "Trigger", "Clinical acuity",
                    "Time sensitivity", "Care-gap severity", "Access barriers", "Language", "Case manager",
                    "Phone status", "Medication context", "Medication status", "Appointment status",
                    "SDOH context", "Data-quality issue", "Next best action", "Priority score", "Priority band",
                    "Case status", "Primary contact route", "Primary contact availability",
                    "Alternate contact name", "Relationship", "Contact role type",
                    "Authorisation / permission status", "Permitted disclosure scope",
                    "Alternate contact window", "Routing recommendation", "Last permission review"],
    "Source Records": ["Member ID", "Dataset", "Source", "Sample fact", "Quality flag",
                       "Freshness (illustrative)", "What nurse should do"],
    "Data Dictionary": ["Dataset", "Source", "Expected freshness", "Handling / product behaviour"],
    "Priority Model": ["Factor / rule", "Weight / formula", "Guardrail"],
    "Task Queue": ["Task ID", "Member ID", "Priority", "Task / next action", "Status", "Due date", "Owner",
                   "Approval", "Evidence / rationale"],
    "KPI Definitions": ["Metric", "Definition", "Proposed target", "Measurement source", "Type"],
    "Risks": ["Risk", "Severity", "Failure mode", "Mitigation", "Domain"],
    "Contact Directory": ["Member ID", "Contact ID", "Contact name", "Contact type", "Relationship",
                          "Phone (fictional)", "Verification status", "Permission / authority evidence",
                          "Permitted scope", "Prohibited / restricted disclosure", "Preferred channel",
                          "Availability window", "Language", "Source", "Last verified / reviewed",
                          "Routing notes"],
    "Contact Routing Rules": ["Case / contact condition", "Preferred outreach target", "Fallback",
                              "System behaviour", "Disclosure control", "Escalation / next step"],
    "Call AI Workflow": ["Stage", "Component / model", "Output", "Guardrail / human control"],
    "AI Copilot": ["Capability", "Example user prompt", "Guardrail"],
}


def clean(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, str):
        return v.strip()
    return v


def table(ws, required):
    it = ws.iter_rows(values_only=True)
    head = [clean(h) for h in next(it)]
    missing = [c for c in required if c not in head]
    if missing:
        sys.exit(f"ERROR: sheet '{ws.title}' is missing column(s): {', '.join(missing)}")
    out = []
    for r in it:
        if all(v is None for v in r):
            continue
        out.append({h: clean(v) for h, v in zip(head, r) if h})
    return out


def main():
    if not SRC.exists():
        sys.exit(f"ERROR: workbook not found: {SRC}")
    wb = openpyxl.load_workbook(SRC, data_only=True)
    missing = [s for s in SHEETS if s not in wb.sheetnames]
    if missing:
        sys.exit(f"ERROR: workbook is missing sheet(s): {', '.join(missing)}")

    data = {}
    for name, req in SHEETS.items():
        ws = wb[name]
        if req is None:
            data[name] = [{"Key": clean(a), "Value": clean(b)} for a, b, *_ in ws.iter_rows(values_only=True, min_col=1, max_col=2)
                          if a is not None and b is not None]
        else:
            data[name] = table(ws, req)

    data["_meta"] = {
        "workbook": SRC.name,
        "sha256": hashlib.sha256(SRC.read_bytes()).hexdigest()[:16],
        "built": datetime.now().isoformat(timespec="seconds"),
    }
    out = ROOT / "data" / "nexus-data.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", out, {k: len(v) for k, v in data.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()

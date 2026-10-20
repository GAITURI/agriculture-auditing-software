import pandas as pd
from sqlalchemy import select
from . import config as C
from .models import Block, FactoryProduction as FP, FruitCollection as FC, Site


def _num(df, cols):
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def daily(db, org_id, start, end):
    idx = pd.date_range(start, end, freq="D", name="date")
    fc = pd.read_sql(select(FC.date, FC.harvested, FC.collected, FC.transported, FC.left_in_field)
                     .join(Block, Block.id == FC.block_id).join(Site, Site.id == Block.site_id)
                     .where(FC.date.between(start, end), Site.org_id == org_id, FC.status != "draft"), db.connection())
    fp = pd.read_sql(select(FP.date, FP.total_received, FP.ffb_banakanuke, FP.ffb_batchepo, FP.ffb_bakilo,
                            FP.processed, FP.oil, FP.downtime).where(FP.date.between(start, end), FP.org_id == org_id), db.connection())
    fc = _num(fc, fc.columns[1:]); fp = _num(fp, fp.columns[1:])
    fc["date"] = pd.to_datetime(fc["date"]); fp["date"] = pd.to_datetime(fp["date"])
    f = fc.groupby("date").sum(min_count=1).reindex(idx)
    p = fp.set_index("date").reindex(idx)
    df = f.join(p[["total_received", "processed", "oil", "downtime"]]).rename(
        columns={"total_received": "received", "left_in_field": "left"})
    return df


def with_metrics(df):
    df = df.copy()
    df["yield_pct"] = (df["oil"] / df["processed"].where(df["processed"] > 0) * 100)
    df["difference"] = df["transported"] - df["received"]  # transported vs received
    # a truck sent late on day N can arrive on day N+1: judge on a 2-day window
    win = df["transported"].fillna(0).rolling(2, min_periods=1).sum() - df["received"].fillna(0).rolling(2, min_periods=1).sum()
    df["window_diff"] = win
    seen = lambda c: df[c].notna().astype(int).rolling(2, min_periods=1).sum() == 0
    miss = seen("transported") | seen("received")  # no data on either side within the window
    df["status"] = "ok"
    df.loc[win.abs() > float(C.VARIANCE_T), "status"] = "flag"
    df.loc[miss, "status"] = "missing"
    df["oer_alert"] = df["yield_pct"].notna() & ~df["yield_pct"].between(C.OER_MIN, C.OER_MAX)
    return df


def records(df):
    out = df.reset_index().copy()
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    out = out.astype(object).where(out.notna(), None)
    return out.to_dict("records")


def summary(db, org_id, start, end):
    df = with_metrics(daily(db, org_id, start, end))
    s = lambda c: None if df[c].isna().all() else round(float(df[c].sum()), 3)
    proc, oil = s("processed"), s("oil")
    past = df[df.index <= pd.Timestamp.today().normalize()]  # days that have not happened yet are not "missing"
    return {"start": str(start), "end": str(end), "harvested": s("harvested"), "collected": s("collected"),
            "transported": s("transported"), "left_in_field": s("left"), "received": s("received"),
            "processed": proc, "oil": oil, "downtime": s("downtime"),
            "yield_pct": round(oil / proc * 100, 2) if proc and oil is not None else None,
            "missing_days": int((past["status"] == "missing").sum()),
            "flagged_days": int((past["status"] == "flag").sum()),
            "oer_alerts": int(past["oer_alert"].sum())}


def timeseries(db, org_id, start, end, freq="D"):
    df = daily(db, org_id, start, end)[["harvested", "collected", "transported", "received", "processed", "oil", "downtime"]]
    rule = {"D": "D", "W": "W-SUN", "M": "MS", "Y": "YS"}[freq]
    g = df.resample(rule).sum(min_count=1)
    g["yield_pct"] = g["oil"] / g["processed"].where(g["processed"] > 0) * 100
    return records(g.round(3))


def blocks(db, org_id):
    q = select(Block.name).join(Site, Site.id == Block.site_id).where(Site.org_id == org_id, Block.is_active).order_by(Block.id)
    return list(db.scalars(q))

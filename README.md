# DPD P&L Tracker

A simple web page to track revenue, costs, routes and profit for the **Raunds** and **Glenfield** DPD depots, per FD (with its email address), per depot, and combined.

## How to open it

- **On your computer:** download the repo and double-click `index.html`. No install or server needed.
- **Online (phone + computer):** in GitHub go to *Settings → Pages*, set *Source* to "Deploy from a branch", choose this branch and `/ (root)`, then open the link GitHub gives you.

> Data is saved **in the browser you use** (localStorage). Use *FDs & settings → Download backup* regularly, and *Restore backup* to move your data to another device/browser.

## First-time setup (FDs & settings tab)

1. Enter the **revenue per route** for Raunds and Glenfield.
2. Set the **Period 1 start date** — the first day of one of your DPD 4-week periods. Weeks (W1–W4) and periods roll forward from that date in 7- and 28-day steps.
3. Add each **FD**: FD number/name, email, depot, and optionally a rate override and default daily **van hire** and **insurance**.

## Daily entry

Pick a date and fill in one card per FD:

| Field | Notes |
| --- | --- |
| Routes | Routes completed that day |
| Rate / route | Pre-filled from the FD override or depot rate |
| Charging | Charging cost |
| Van hire / Insurance | Auto-filled from the FD's daily defaults when you type routes |
| Van damages | Any damage costs |

Revenue = routes × rate. Leave a card blank to skip that FD; clearing a saved card removes it.

## Dashboard

- **Daily / Weekly / 4-week period** views, with ‹ › to move back and forward.
- **Showing:** all depots combined, Raunds only, Glenfield only, or a single FD (individual report).
- KPIs: profit, margin, revenue, routes completed, revenue per route, profit per route, total costs, charging, van hire, insurance, van damages.
- **Depot table:** Raunds, Glenfield and combined side by side.
- **FD table:** every FD with its email and depot — tap one to open its own report.
- **Breakdown:** day-by-day for a week; week-by-week and day-by-day for a period. Tap a row to drill in.
- **Export report CSV** (opens in Excel) and **Print**.

The *All entries* tab lists every entry for any date range, with edit, delete and CSV export.

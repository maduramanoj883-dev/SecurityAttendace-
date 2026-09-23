# Point Watch — Guard Attendance System

An independent, self-hosted attendance system for a multi-branch security company. Each
security point logs its guards shift by shift; head office watches every point at once
and exports the whole log to Excel. No third-party accounts required — you own the
server, the login accounts, and the data.

## What's included

- **Point / OIC login** — one account per security point. Can only log attendance for its
  own point: point/location, OIC name, date, time, and one entry per guard on site
  (name, shift, on/off-duty time, live photo taken with the device camera).
- **Head office login** — sees every point's submissions live, filters by date / point /
  shift, and downloads an Excel (`.xlsx`) file of the current view.
- **Login management** — head office can create and remove point/OIC and office logins
  from inside the app, so only people you've issued a password to can submit or view data.
- A small built-in database (a JSON file on disk) — nothing extra to install or configure.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer, installed on whatever machine or hosting
  account will run the server.

## Run it locally (to try it out)

```bash
cd point-watch
npm install
npm start
```

Open `http://localhost:3000`. The first time it runs, it prints a default head-office
login to the terminal:

```
username: admin
password: ChangeMe123!
```

Log in with that, then immediately:
1. Go to **Point & OIC logins** and create a real head-office account for yourself.
2. Create one point/OIC login per security location (e.g. username `kollupitiya-oic`,
   password of your choosing, point = "Kollupitiya Retail Point").
3. Delete or change the password on the default `admin` account.

## Configuration

Copy `.env.example` to `.env` and edit it before running in production:

```bash
cp .env.example .env
```

- `PORT` — which port the server listens on.
- `JWT_SECRET` — set this to a long random string (e.g. `openssl rand -hex 32`). This is
  what keeps login sessions secure — don't leave the default in production.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — only used the very first time the server starts
  with an empty database, to create the initial head-office login.

## Deploying so every branch can reach it

The app is a normal Node.js web server, so any of these work:

- **A small VPS** (DigitalOcean, Linode, a local Sri Lankan host, etc.): install Node,
  copy this folder up, run `npm install && npm start` behind a process manager like
  [PM2](https://pm2.keymetrics.io/) (`pm2 start server.js --name point-watch`) so it
  restarts automatically, and put Nginx in front for HTTPS.
- **A managed host** (Render, Railway, Fly.io): push this folder as a Node.js web
  service — they handle HTTPS and restarts for you. Set the environment variables from
  `.env.example` in their dashboard rather than committing a `.env` file.
- **An office server / NAS**: same as the VPS route, just running on your own hardware.

Whichever you choose, each security point just needs the resulting URL (e.g.
`https://attendance.yourcompany.lk`) bookmarked on the phone or tablet at that point, and
their own point/OIC login.

## Data & photos

- Attendance records live in `data/db.json`. Back this file up regularly (it's the whole
  database) — copying it is your backup.
- Live photos are saved to the `uploads/` folder and served back to the dashboard from
  there. Back that up alongside `data/db.json`.
- If your volume grows large enough that a JSON file starts to feel slow (many hundreds
  of points, years of history), swap `store.js` for a real database — the rest of the
  app talks to it through `store.load()` / `store.save()`, so that's the only file that
  needs to change.

## Security notes

- Change `JWT_SECRET` and the default admin password before putting this in front of
  real staff.
- Put it behind HTTPS in production (a reverse proxy like Nginx with Let's Encrypt, or
  your hosting provider's built-in HTTPS) — logins and photos should not travel over
  plain HTTP.
- Point/OIC accounts can only submit for their own assigned point; only head-office
  accounts can view the dashboard, export data, or manage logins.

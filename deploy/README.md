# Deploying CS++ Flappy

The setup for the event:

```
  players' phones                      laptop at the stand
  (mobile data or any wifi)            (browser, shows the QR + leaderboard)
         |                                      |
         |            internet                  |
         +----------------+---------------------+
                          |
                     your VPS
                  node server.js
                  SQLite database
```

The laptop **serves nothing** — it just opens the display page from the VPS in
a browser. Everything runs on the VPS, so the game keeps working even if the
venue wifi is hostile or the laptop dies.

## 1. First deploy

On the VPS, as a user with sudo:

```bash
git clone <your-repo-url> cspp-flappy
cd cspp-flappy
sudo bash deploy/setup.sh
```

That installs Node 22, creates an unprivileged `cspp` user, installs the app
to `/srv/cspp-flappy`, puts the database in `/var/lib/cspp-flappy`, and
registers a systemd service that starts on boot and restarts on crash.

Then open the firewall:

```bash
sudo ufw allow 3000/tcp
```

Check it from your own machine:

```bash
curl http://<server-ip>:3000/api/health
```

## 2. Add a domain and HTTPS

**Do this before the event, not on the day.** Two reasons it matters more
than it sounds:

- Browsers show warnings on plain `http`, and a warning page between a
  student and the game costs you players at a stand.
- A short domain is far easier to read out loud than an IP address when the
  QR code fails for someone.

Point a domain's A record at the server, then:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/cspp-flappy
# edit the server_name line to your domain
sudo ln -sf /etc/nginx/sites-available/cspp-flappy /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d flappy.yourdomain.com
```

Certbot rewrites the config for HTTPS and sets up automatic renewal. Then
close the direct port so everything goes through nginx:

```bash
sudo ufw delete allow 3000/tcp
sudo ufw allow 'Nginx Full'
```

## 3. Updating

```bash
cd ~/cspp-flappy
git pull
sudo bash deploy/setup.sh
```

The database lives outside the app directory, so redeploying never touches
the scores.

## 4. On the day

1. Confirm the server is up: `systemctl status cspp-flappy`
2. On the stand laptop, open **`https://your-domain/display`** and press F11
   for fullscreen.
3. That's it. The QR code on screen points at the same server the page came
   from, so there is nothing to configure.

If you need the QR to point somewhere other than the address the laptop is
browsing — a short vanity domain in front, say — append it:

```
https://your-domain/display?url=https://play.yourdomain.com
```

### Before you leave for the venue

- Scan the QR with your own phone **on mobile data, with wifi off**. That is
  exactly what a student's phone will do, and it proves the whole path works
  from outside your network.
- Check the leaderboard updates after you play a round.
- Have the URL written down somewhere. If the projector or laptop fails you
  can still tell people where to go.

## Backups

The whole database is one file. During the event:

```bash
sudo sqlite3 /var/lib/cspp-flappy/flappy.sqlite ".backup '/tmp/flappy-backup.sqlite'"
```

Use `.backup` rather than copying the file — SQLite is in WAL mode, so a
plain `cp` of the `.sqlite` file can miss the newest scores sitting in the
`-wal` sidecar.

To pull the results afterwards:

```bash
scp user@server:/var/lib/cspp-flappy/flappy.sqlite .
node scripts/players.js --csv > players.csv
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Service will not start | `journalctl -u cspp-flappy -n 50 --no-pager` |
| Works locally, not from outside | Firewall: `sudo ufw status`. Also check the VPS provider's own firewall or security group — that is a separate layer people forget. |
| `better-sqlite3` build errors | Node is older than 20. `node -v`, then re-run `setup.sh`. |
| Scores not saving | Permissions on `/var/lib/cspp-flappy` — it must be owned by `cspp`. |
| QR code points at the wrong host | The display page encodes the address it was opened at. Open it via the public domain, not `localhost`. |

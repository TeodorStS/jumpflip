# Deploying CS++ Flappy with Docker

A step-by-step guide for putting the game on your own server.

Written to be followed in order. Each step says what to run, what you should
see, and what to do if you see something else. If you get stuck, paste the
step number and the error you got back to Claude and it will have the context
it needs.

**Time needed:** about 30 minutes for steps 1–5. Step 6 (domain + HTTPS) adds
another 15 and needs a domain name.

---

## What you are building

```
  players' phones                        laptop at the stand
  (mobile data, any wifi)                (browser showing QR + leaderboard)
         |                                        |
         |               internet                 |
         +--------------------+-------------------+
                              |
                        your server
                   ┌──────────────────────┐
                   │  nginx  (port 443)   │  <- step 6
                   │        │             │
                   │  docker container    │
                   │  node + SQLite       │
                   │        │             │
                   │  volume: scores      │  <- survives restarts
                   └──────────────────────┘
```

The laptop at the stand **serves nothing**. It just opens a web page from the
server. Everything runs on the server.

---

## Before you start

You need:

- A server with a public IP, running Ubuntu 22.04 or 24.04 (Debian works too)
- SSH access to it
- Your code pushed to a git repository the server can reach

You do **not** need Docker installed on your laptop. Everything happens on the
server.

---

## Step 1 — Connect to your server

```bash
ssh your-user@your-server-ip
```

You should get a shell prompt. Everything from here runs on the server unless
it says otherwise.

> **If this fails:** check the IP is right and that your provider's firewall
> allows port 22. Most providers have a web console you can use to get in and
> fix things.

---

## Step 2 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Then let your user run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
```

**Log out and back in** for that to take effect:

```bash
exit
ssh your-user@your-server-ip
```

Check it worked:

```bash
docker run --rm hello-world
```

You should see "Hello from Docker!". If you get "permission denied", you
skipped the log-out step.

---

## Step 3 — Get the code onto the server

```bash
git clone <your-repository-url> cspp-flappy
cd cspp-flappy
```

Check the files you need are there:

```bash
ls Dockerfile docker-compose.yml
```

Both should be listed.

---

## Step 4 — Build and start it

```bash
docker compose up -d --build
```

The first build takes 1–3 minutes. You will see it download a Node image and
install dependencies.

Check it is running:

```bash
docker compose ps
```

You want to see `cspp-flappy` with status `Up ... (healthy)`.

> **`healthy` matters.** It means the app is actually answering requests, not
> just that the process started. If it says `unhealthy` or keeps restarting,
> go to Troubleshooting at the bottom.

Test it locally on the server:

```bash
curl http://localhost:3000/api/health
```

Expected: `{"ok":true}`

---

## Step 5 — Open the firewall

The app works on the server but the outside world cannot reach it yet.

```bash
sudo ufw allow 3000/tcp
sudo ufw allow OpenSSH
sudo ufw enable
```

> **Do not skip `allow OpenSSH`.** Enabling the firewall without it will lock
> you out of your own server.

Now test from your own laptop, not the server:

```bash
curl http://YOUR-SERVER-IP:3000/api/health
```

Expected: `{"ok":true}`

> **If this times out** but works on the server itself, your hosting provider
> has its own firewall on top of ufw. Check for "Firewall", "Security Groups"
> or "Network rules" in their web console and allow port 3000 there too. This
> catches people out constantly.

**At this point the game works.** You can stop here and use
`http://YOUR-SERVER-IP:3000` for the event. Step 6 makes it nicer and is
strongly recommended, but it is optional.

---

## Step 6 — Add a domain and HTTPS

Worth doing because:

- Browsers show a "Not secure" warning on plain `http`. A warning page
  between a student and the game costs you players.
- A short domain is much easier to read aloud than an IP when someone's
  camera will not scan the QR code.

### 6a. Point a domain at the server

In your domain registrar's DNS settings, add an **A record**:

| Type | Name | Value |
|------|------|-------|
| A | `flappy` | `YOUR-SERVER-IP` |

That gives you `flappy.yourdomain.com`. DNS takes a few minutes to propagate.
Check it with:

```bash
dig +short flappy.yourdomain.com
```

Wait until that prints your server's IP before continuing.

### 6b. Install nginx and certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 6c. Configure nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/cspp-flappy
sudo nano /etc/nginx/sites-available/cspp-flappy
```

Change this line to your domain, then save (Ctrl+O, Enter, Ctrl+X):

```
server_name flappy.yourdomain.com;
```

The config uses a rate limit, which needs a zone defined globally:

```bash
sudo nano /etc/nginx/nginx.conf
```

Inside the `http { ... }` block, add:

```
limit_req_zone $binary_remote_addr zone=cspp:10m rate=10r/s;
```

Enable the site and remove nginx's default page:

```bash
sudo ln -sf /etc/nginx/sites-available/cspp-flappy /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
```

`nginx -t` must say "syntax is ok" and "test is successful". If it does not,
the error message names the file and line.

```bash
sudo systemctl reload nginx
```

### 6d. Get the certificate

```bash
sudo certbot --nginx -d flappy.yourdomain.com
```

Answer the prompts (email, agree to terms). Choose **redirect** when it asks
about HTTP to HTTPS.

Certbot edits the nginx config for you and sets up automatic renewal.

### 6e. Lock down the direct port

Now that traffic goes through nginx, stop exposing the app directly:

```bash
sudo ufw delete allow 3000/tcp
sudo ufw allow 'Nginx Full'
```

Then bind the container to localhost only. Edit `docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

Apply it:

```bash
docker compose up -d
```

Check the site: **https://flappy.yourdomain.com** should load the game with a
padlock in the address bar.

---

## Step 6.5 — The dev page

`/dev` is the organisers' page:

- **Every player with their student number**, best first, with their number
  of attempts, average score and when they last played, plus a search box
- **Export CSV** — the whole list as a spreadsheet, for picking the winners
- **Delete** a player and all their attempts, or click a player's attempt
  count to see every attempt and delete just one — their best score is
  worked out again from what is left
- **Live monitor** — players, attempts, top and average score, attempts in
  the last 10 minutes, time since the last attempt, and server uptime,
  refreshing every 5 seconds. A red dot means the page cannot reach the
  server; uptime dropping back to seconds means the server restarted.

It is **switched off until you give it a password.** On the server:

```bash
nano docker-compose.yml
```

Find this line and type a password between the quotes:

```yaml
      ADMIN_PASSWORD: ""
```

Use 12 or more characters — it guards every student number.
`openssl rand -base64 18` makes a good one. If your password contains a `$`,
write it as `$$`. Save (Ctrl+O, Enter, Ctrl+X) and apply it:

```bash
docker compose up -d
```

Open **`https://flappy.yourdomain.com/dev`**. The browser asks for a username
and password: type anything as the username (`admin` is fine) and your
password. It remembers them until you close the browser.

> **Do this after step 6 (HTTPS).** The browser sends the password with every
> request; over plain `http`, anyone on the same Wi-Fi can read it.

> **Keep the password off GitHub.** Edit `docker-compose.yml` on the server
> only, and never commit that change.

**Deleting cannot be undone.** Every deletion is written to the log
(`docker compose logs | grep deleted`), so you can see what was removed.

**Never put `/dev` on the stand screen.** Use `/display` for the public
screen — it shows names and scores only.

## Step 7 — The day of the event

1. **Check the server is up** (do this the morning of, not on arrival):

   ```bash
   docker compose ps
   curl https://flappy.yourdomain.com/api/health
   ```

2. **On the stand laptop**, open:

   ```
   https://flappy.yourdomain.com/display
   ```

   Press **F11** for fullscreen. That is the whole setup — the QR code on
   screen points at the same server the page came from.

   The board shows the top 10. To show more, move the mouse over the
   leaderboard and pick **10** or **20**, or type any number up to 100 and
   press Enter. The screen remembers the choice. If more players are asked
   for than fit, the list scrolls itself.

3. **Test with your own phone on mobile data, wifi off.** This is the single
   most important check. It is exactly what a student's phone will do, and it
   proves the whole path works from outside your network. Testing from the
   laptop proves nothing about the phone path.

4. Write the URL on a whiteboard or a printed sheet as a backup. If the
   projector fails you can still tell people where to go.

---

## Day-to-day commands

| What | Command |
|------|---------|
| Live monitor (browser) | open `https://flappy.yourdomain.com/dev` |
| Watch logs live — one line per game | `docker compose logs -f` |
| CPU and memory | `docker stats cspp-flappy` |
| Last 50 log lines | `docker compose logs --tail 50` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` |
| Start after stopping | `docker compose up -d` |
| Deploy a code change | `git pull && docker compose up -d --build` |
| Check status | `docker compose ps` |
| Change the dev password | edit `ADMIN_PASSWORD` in `docker-compose.yml`, then `docker compose up -d` |

**Deploying a change never touches the scores.** The database lives in a
Docker volume, separate from the container. I tested this: destroying the
container, rebuilding the image from scratch and starting fresh left all the
data intact.

---

## Getting the results out

The quickest way: open `/dev` and press **Export CSV**. You get every
player, best first, with their student number.

Or from the server's command line:

```bash
# The same CSV as the button (put your dev password after "admin:")
curl -s -u 'admin:YOUR-PASSWORD' http://localhost:3000/dev/players.csv > players.csv

# Summary
docker compose exec flappy npm run players -- --stats

# Full leaderboard
docker compose exec flappy npm run players

# Export to CSV
docker compose exec flappy npm run players -- --csv > players.csv
```

To copy the CSV to your own machine (run this on your laptop):

```bash
scp your-user@your-server-ip:~/cspp-flappy/players.csv .
```

### Backing up the database

```bash
docker compose exec flappy npm run backup
docker compose cp flappy:/data/backup.sqlite ./flappy-backup.sqlite
```

> **Use this, not a plain file copy.** SQLite runs in WAL mode, so most recent
> scores can be sitting in a separate `-wal` file rather than in
> `flappy.sqlite` itself. On a live server I measured the main file at 4 KB
> with 78 KB in the WAL — copying just the one file would have lost nearly
> everything.

---

## Troubleshooting

### Container keeps restarting

```bash
docker compose logs --tail 50
```

The error is almost always in the last few lines.

### "port is already allocated"

Something else is using port 3000.

```bash
sudo lsof -i :3000
```

Either stop that process, or run the game on a different port:

```bash
FLAPPY_PORT=8080 docker compose up -d
```

### Works on the server, not from outside

Three layers can block it, in order of likelihood:

1. **Your provider's firewall** — a web console setting, separate from ufw
2. **ufw** — `sudo ufw status`
3. **The container binding** — `docker compose ps` should show `0.0.0.0:3000->3000/tcp`,
   not `127.0.0.1:3000->3000/tcp` (unless you are on step 6e, where localhost
   is correct)

### Status shows `unhealthy`

The process is running but not answering. Check the logs, then:

```bash
docker compose exec flappy curl -v http://127.0.0.1:3000/api/health
```

### `/dev` says "The dev page is switched off"

`ADMIN_PASSWORD` in `docker-compose.yml` is still empty. Set it (step 6.5),
then `docker compose up -d`.

### `git pull` refuses: "local changes to docker-compose.yml would be overwritten"

That is your password edit meeting an update to the same file. Set it
aside, update, and put it back:

```bash
git stash && git pull && git stash pop
docker compose up -d --build
```

### Scores disappeared

Check the volume still exists:

```bash
docker volume ls | grep cspp
```

You should see `cspp-flappy-data`. If it is gone, someone ran
`docker compose down -v` — the `-v` deletes volumes. Plain `down` does not.

### Out of disk space

```bash
df -h
docker system prune -a
```

`prune -a` removes unused images and build cache. It does **not** touch named
volumes, so your scores are safe.

---

## What to tell Claude if you get stuck

Paste back:

1. The step number you were on
2. The exact command you ran
3. The full output or error

Plus the output of these two, which answer most questions immediately:

```bash
docker compose ps
docker compose logs --tail 30
```

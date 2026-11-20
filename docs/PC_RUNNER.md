# Notice reader on your PC

Many Indian government recruitment sites don't answer computers outside India (20 of 51 answered GitHub's US servers; 37 of 51 answered from India). So the notice reader runs on a computer in India: your Windows PC for now, a free Indian cloud server before launch.

Your PC becomes a **GitHub self-hosted runner**: it waits for jobs from GitHub, runs them, and reports back. Only the **Notice reader** workflow uses it. Website builds and deploys stay on GitHub's own servers.

## Safety first (public repository)

GitHub warns that a self-hosted runner on a public repository could be made to run a stranger's code through a pull request. Two settings close that:

1. **Repo → Settings → Actions → General → "Approval for running fork pull request workflows from contributors"** → choose **Require approval for all external contributors** → **Save**.
2. The Notice reader workflow only starts **on its schedule or when you press Run workflow**. It never runs for pull requests. Don't change that.

Also: run the runner from a normal (non-administrator) PowerShell, and keep it in its own folder outside OneDrive.

## One-time setup (about 15 minutes)

### 1. Install the OCR program for scanned pages
Open **PowerShell** and run:

```
winget install --id UB-Mannheim.TesseractOCR -e
```

Then add Hindi: download `hin.traineddata` from https://github.com/tesseract-ocr/tessdata_best and copy it into `C:\Program Files\Tesseract-OCR\tessdata\` (Windows will ask for permission).

Check it worked (open a **new** PowerShell window):

```
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

The list should include `eng` and `hin`.

### 2. Register your PC as a runner
1. GitHub → **akhil6174/myavedan → Settings → Actions → Runners → New self-hosted runner**.
2. Choose **Windows** and **x64**. GitHub shows commands with a one-time token. Run them in PowerShell, **but change the folder** to one outside OneDrive:

   ```
   mkdir C:\actions-runner; cd C:\actions-runner
   ```

   then the download and extract commands GitHub shows, then its `./config.cmd --url ... --token ...` command.
3. When `config.cmd` asks questions:
   - Runner group: press **Enter** (Default)
   - Runner name: `myavedan-pc`
   - **Additional labels: `india`** (important: the workflow looks for this label)
   - Work folder: press **Enter**
   - Run as a service: **N** (you start it when you want it to work)

### 3. Start it
Whenever you want the reader to be able to run:

```
cd C:\actions-runner; .\run.cmd
```

Leave that window open. It shows "Listening for Jobs". Close the window to stop it.

On GitHub, **Settings → Actions → Runners** should show `myavedan-pc` as **Idle** (green).

### 4. Gemini key on the PC (for testing)
So the reader can be tested here as well as through GitHub, put the key in a local file that is never committed:

1. In the project folder, create `pipeline\.env` (Notepad → Save as → "All files").
2. One line: `GEMINI_API_KEY=your-key`
3. Save. `.gitignore` already excludes `.env` files.

## How it runs

- **Schedule:** 11:00 and 19:00 IST, if the runner is started then. Missed runs are simply skipped.
- **By hand:** GitHub → **Actions → Notice reader → Run workflow**.
- New drafts appear in the review console at https://admin-staging.myavedan.in.

## Moving to a server later
The same runner can be installed on a free Oracle Cloud server in Mumbai or Hyderabad (Linux) so it runs 24/7. The workflow doesn't change; only the machine does.

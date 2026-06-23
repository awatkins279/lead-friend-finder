## Plan to fix People Search selection

1. **Stop relying on slow exact database counts for every filtered search**
   - The current page tries to exact-count filtered results, which can timeout on large lead searches.
   - Replace that with a lightweight counting strategy that only needs to know whether the result set is selectable, and shows a stable user-facing count when available.

2. **Make “Select matching” select the actual matching result set, not an arbitrary 50k target**
   - When the list shows 16,675 matching leads, the button should say `Select matching (16,675)` and finish at 16,675.
   - It should never keep running toward 50,000 unless there are actually 50,000+ matching leads.

3. **Add a server-side bulk selection function that returns IDs plus the real selected total**
   - Move the bulk loop logic to the backend so the browser is not responsible for dozens of fragile requests.
   - Fetch IDs in pages, stop when the result set ends, and hard-stop at 50,001 so the UI can show “cannot select more than 50,000.”
   - Do not score, call, email, or contact anyone — this only selects lead IDs.

4. **Fix the UI states**
   - Show progress like `Selecting 2,500 / 16,675` only when the total is known.
   - If total is unknown, show `Selecting 2,500…` without implying the target is 50,000.
   - After completion, replace the selected set with the exact returned IDs.

5. **Preserve existing filters and lead database behavior**
   - Keep the shared filter builder so visible rows and bulk selection use the same filters.
   - Keep the 50,000 max selection rule.
   - Keep “Advanced Selection” for choosing a smaller number.

6. **Verify in preview**
   - Test People Search with the company-size filters shown in your session.
   - Confirm the menu text, progress text, selected count, and error behavior match normal lead database logic.
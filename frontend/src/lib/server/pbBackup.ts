import { getAdminToken, pbUrl } from './pbAdmin';

export interface BackupInfo {
	key: string;
	size: number;
	modified: string;
}

/**
 * Wraps PocketBase's own full-instance backup feature (SQLite data + all
 * uploaded files, zipped) so a platform admin can make/download/restore a
 * backup from within the app instead of needing shell access to the server.
 * Every call authenticates as the PocketBase superuser — these endpoints
 * don't exist for regular app users, on purpose.
 */
export async function listBackups(): Promise<BackupInfo[]> {
	const token = await getAdminToken();
	const res = await fetch(`${pbUrl()}/api/backups`, { headers: { Authorization: token } });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

export async function createBackup(name?: string): Promise<void> {
	const token = await getAdminToken();
	const res = await fetch(`${pbUrl()}/api/backups`, {
		method: 'POST',
		headers: { Authorization: token, 'Content-Type': 'application/json' },
		body: JSON.stringify(name ? { name } : {})
	});
	if (!res.ok) throw new Error(await res.text());
}

export async function deleteBackup(key: string): Promise<void> {
	const token = await getAdminToken();
	const res = await fetch(`${pbUrl()}/api/backups/${encodeURIComponent(key)}`, {
		method: 'DELETE',
		headers: { Authorization: token }
	});
	if (!res.ok) throw new Error(await res.text());
}

/**
 * Streams a backup zip through our own server so the browser never needs the
 * PocketBase superuser token — it only ever talks to our app with its own
 * (platform-admin) session token.
 */
export async function fetchBackupFile(key: string): Promise<Response> {
	const token = await getAdminToken();
	const tokenRes = await fetch(`${pbUrl()}/api/files/token`, {
		method: 'POST',
		headers: { Authorization: token }
	});
	if (!tokenRes.ok) throw new Error(await tokenRes.text());
	const fileToken = (await tokenRes.json()).token;

	const res = await fetch(`${pbUrl()}/api/backups/${encodeURIComponent(key)}?token=${fileToken}`);
	if (!res.ok) throw new Error(await res.text());
	return res;
}

/** Uploads a backup zip and immediately restores from it (restarts PocketBase). */
export async function uploadAndRestoreBackup(file: Blob, fileName: string): Promise<void> {
	const token = await getAdminToken();

	const form = new FormData();
	form.append('file', file, fileName);
	const uploadRes = await fetch(`${pbUrl()}/api/backups/upload`, {
		method: 'POST',
		headers: { Authorization: token },
		body: form
	});
	if (!uploadRes.ok) throw new Error(await uploadRes.text());

	const restoreRes = await fetch(`${pbUrl()}/api/backups/${encodeURIComponent(fileName)}/restore`, {
		method: 'POST',
		headers: { Authorization: token }
	});
	// PocketBase restarts its process as part of restoring, so the connection
	// can drop before a normal response arrives — that's expected, not a
	// failure, as long as the request itself was accepted.
	if (!restoreRes.ok && restoreRes.status !== 0) {
		throw new Error(await restoreRes.text().catch(() => 'Herstellen is mislukt'));
	}
}

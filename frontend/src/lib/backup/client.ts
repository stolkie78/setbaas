import { base } from '$app/paths';
import { pb } from '$lib/pocketbase';

export interface BackupInfo {
	key: string;
	size: number;
	modified: string;
}

async function readError(res: Response): Promise<string> {
	const data = await res.json().catch(() => ({}));
	return data.error || 'De aanvraag is mislukt.';
}

export async function listBackups(): Promise<BackupInfo[]> {
	const res = await fetch(`${base}/api/backups`, {
		headers: { Authorization: pb.authStore.token }
	});
	if (!res.ok) throw new Error(await readError(res));
	return res.json();
}

export async function createBackup(): Promise<void> {
	const res = await fetch(`${base}/api/backups`, {
		method: 'POST',
		headers: { Authorization: pb.authStore.token }
	});
	if (!res.ok) throw new Error(await readError(res));
}

export async function deleteBackup(key: string): Promise<void> {
	const res = await fetch(`${base}/api/backups/${encodeURIComponent(key)}`, {
		method: 'DELETE',
		headers: { Authorization: pb.authStore.token }
	});
	if (!res.ok) throw new Error(await readError(res));
}

/** Downloads a backup zip via our server and triggers a browser save-as. */
export async function downloadBackup(key: string): Promise<void> {
	const res = await fetch(`${base}/api/backups/${encodeURIComponent(key)}`, {
		headers: { Authorization: pb.authStore.token }
	});
	if (!res.ok) throw new Error(await readError(res));

	const blob = await res.blob();
	if (blob.size === 0) {
		throw new Error('De gedownloade backup is leeg.');
	}

	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = key;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();

	// Safari may not start reading the object URL until after the click handler
	// returns. Revoking it immediately silently cancels the download.
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Uploads and restores a backup zip. This overwrites all current data. */
export async function restoreBackup(file: File): Promise<void> {
	const form = new FormData();
	form.append('file', file);
	const res = await fetch(`${base}/api/backups/restore`, {
		method: 'POST',
		headers: { Authorization: pb.authStore.token },
		body: form
	});
	if (!res.ok) throw new Error(await readError(res));
}

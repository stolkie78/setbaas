import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { isMailConfigured, sendMail } from '$lib/server/mailer';

export const POST: RequestHandler = async ({ request }) => {
	const { email, club, clubName, role, invitedBy, siteUrl } = await request.json();

	if (!email || !club || !role) {
		return new Response(JSON.stringify({ error: 'Missing email, club or role' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Generate invite token
	const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

	// Calculate expiry (7 days)
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

	// Create invitation record in PocketBase
	const pbUrl = pubEnv.PUBLIC_POCKETBASE_URL || 'http://pb:8090';
	const adminEmail = env.PB_ADMIN_EMAIL;
	const adminPassword = env.PB_ADMIN_PASSWORD;

	if (!adminEmail || !adminPassword) {
		return new Response(JSON.stringify({ error: 'Server niet geconfigureerd (PB admin credentials ontbreken)' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Auth as admin
	let adminToken: string;
	try {
		const authRes = await fetch(`${pbUrl}/api/admins/auth-with-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identity: adminEmail, password: adminPassword })
		});
		if (!authRes.ok) {
			// Try superuser endpoint
			const suRes = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identity: adminEmail, password: adminPassword })
			});
			if (!suRes.ok) throw new Error('Admin auth failed');
			const suData = await suRes.json();
			adminToken = suData.token;
		} else {
			const authData = await authRes.json();
			adminToken = authData.token;
		}
	} catch (e) {
		return new Response(JSON.stringify({ error: 'Server auth fout' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Create invitation record
	try {
		const createRes = await fetch(`${pbUrl}/api/collections/invitations/records`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: adminToken
			},
			body: JSON.stringify({
				email,
				token,
				club,
				role,
				status: 'pending',
				invited_by: invitedBy || '',
				expires_at: expiresAt
			})
		});
		if (!createRes.ok) {
			const err = await createRes.text();
			throw new Error(err);
		}
	} catch (e) {
		return new Response(JSON.stringify({ error: `Kon uitnodiging niet opslaan: ${e}` }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Send email
	if (!isMailConfigured()) {
		// No SMTP configured — return success with the link so admin can share manually
		const inviteLink = `${siteUrl || 'http://localhost:3000'}/invite/${token}`;
		return new Response(JSON.stringify({
			success: true,
			emailSent: false,
			inviteLink,
			message: 'Uitnodiging aangemaakt maar SMTP niet geconfigureerd. Deel de link handmatig.'
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const inviteLink = `${siteUrl || 'http://localhost:3000'}/invite/${token}`;
		const roleLabel = role === 'admin' ? 'Admin' : role === 'user' ? 'Gebruiker' : 'Lezer';

		await sendMail({
			to: email,
			subject: `Uitnodiging voor ${clubName || 'een club'} op SetBaas`,
			html: `
				<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
					<h2 style="color: #2563eb;">🏐 Je bent uitgenodigd!</h2>
					<p>Je bent uitgenodigd als <strong>${roleLabel}</strong> voor <strong>${clubName || 'een club'}</strong> op SetBaas.</p>
					<p>Klik op de onderstaande knop om je account aan te maken en toegang te krijgen:</p>
					<a href="${inviteLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">
						Accepteer uitnodiging
					</a>
					<p style="color: #666; font-size: 12px; margin-top: 24px;">
						Deze uitnodiging is 7 dagen geldig.<br>
						Of kopieer deze link: <a href="${inviteLink}">${inviteLink}</a>
					</p>
				</div>
			`
		});

		return new Response(JSON.stringify({ success: true, emailSent: true }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		const inviteLink = `${siteUrl || 'http://localhost:3000'}/invite/${token}`;
		return new Response(JSON.stringify({
			success: true,
			emailSent: false,
			inviteLink,
			message: `Email versturen mislukt (${e}). Deel de link handmatig.`
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

const PDFDocument = require('pdfkit');

function safeText(value, fallback = '—') {
	const s = String(value ?? '').trim();
	return s ? s : fallback;
}

function safeFileSlug(value) {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9_-]/g, '')
		.slice(0, 64);
}

function dateTimeText(value) {
	if (!value) return '—';
	try {
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return String(value);
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		const hh = String(d.getHours()).padStart(2, '0');
		const mi = String(d.getMinutes()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
	} catch {
		return String(value);
	}
}

function formatInt(value) {
	const n = Number(value || 0);
	if (!Number.isFinite(n)) return '0';
	try {
		return Math.trunc(n).toLocaleString('es-PE');
	} catch {
		return String(Math.trunc(n));
	}
}

function formatDec2(value) {
	const n = Number(value || 0);
	if (!Number.isFinite(n)) return '0.00';
	try {
		return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	} catch {
		return n.toFixed(2);
	}
}

function formatPct01(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return '—';
	return `${formatDec2(n * 100)}%`;
}

function clamp01(n) {
	if (!Number.isFinite(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

function drawCard(doc, { x, y, w, h, fill = '#ffffff', stroke = '#e5e7eb', radius = 10 }) {
	doc.save();
	doc.lineWidth(1);
	doc.fillColor(fill);
	doc.strokeColor(stroke);
	doc.roundedRect(x, y, w, h, radius).fillAndStroke();
	doc.restore();
}

function drawSectionTitle(doc, { x, y, title, accentColor }) {
	doc.save();
	doc.rect(x, y + 2, 3, 14).fill(accentColor);
	doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(String(title || ''), x + 10, y, { width: 999 });
	doc.restore();
}

function drawKeyValue(doc, { x, y, w, key, value }) {
	doc.font('Helvetica').fontSize(9).fillColor('#555555').text(String(key || ''), x, y, { width: w });
	doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(String(value ?? '—'), x, y + 12, { width: w });
}

function drawMiniBars(doc, { x, y, w, h, values, color = '#2563eb' }) {
	const nums = Array.isArray(values) ? values.map((v) => Number(v || 0)).map((n) => (Number.isFinite(n) ? n : 0)) : [];
	if (!nums.length) {
		doc.save();
		doc.fillColor('#64748b').font('Helvetica').fontSize(9).text('Sin datos', x, y + Math.floor(h / 2) - 6, { width: w, align: 'center' });
		doc.restore();
		return;
	}
	const max = Math.max(...nums, 0);
	const n = nums.length;
	const gap = 2;
	const barW = Math.max(1, Math.floor((w - gap * (n - 1)) / n));

	doc.save();
	doc.fillColor(color);
	for (let i = 0; i < n; i++) {
		const t = max > 0 ? clamp01(nums[i] / max) : 0;
		const bh = Math.max(1, Math.floor(h * t));
		const bx = x + i * (barW + gap);
		const by = y + (h - bh);
		doc.roundedRect(bx, by, barW, bh, 2).fill();
	}
	doc.restore();
}

function writeBranchAnalyticsPdf(res, { branch, days, series, totals }) {
	const doc = new PDFDocument({ size: 'A4', margin: 48 });
	res.setHeader('Content-Type', 'application/pdf');

	const branchName = branch?.name || `Sucursal ${branch?.id ?? 'NA'}`;
	const firstDay = Array.isArray(series) && series.length ? series[0]?.day : null;
	const lastDay = Array.isArray(series) && series.length ? series[series.length - 1]?.day : null;
	const slug = safeFileSlug(branchName) || `branch-${branch?.id ?? 'na'}`;
	const safeRange = `${safeFileSlug(firstDay) || 'na'}-${safeFileSlug(lastDay) || 'na'}`;
	res.setHeader('Content-Disposition', `attachment; filename="reporte-${slug}-${safeRange}.pdf"`);

	doc.pipe(res);

	const accent = '#2563eb';
	const pageX = doc.page.margins.left;
	const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

	function drawFooter() {
		const footY = doc.page.height - doc.page.margins.bottom - 16;
		doc.save();
		doc.font('Helvetica').fontSize(8).fillColor('#64748b').text('Sistema de Gestión de Cementerios · Reporte PDF', pageX, footY, {
			width: pageW,
			align: 'center',
		});
		doc.restore();
	}

	// Header minimal
	const headerY = doc.page.margins.top - 12;
	const headerH = 70;
	doc.roundedRect(pageX, headerY, pageW, headerH, 12).fill('#0f172a');
	doc.rect(pageX, headerY, 10, headerH).fill(accent);

	doc
		.fillColor('#ffffff')
		.font('Helvetica-Bold')
		.fontSize(16)
		.text('Reporte y análisis por sucursal', pageX + 18, headerY + 14, { width: pageW - 36 });
	doc
		.font('Helvetica')
		.fontSize(10)
		.fillColor('#e5e7eb')
		.text(`${safeText(branchName)} · Últimos ${Number(days) || 0} días`, pageX + 18, headerY + 38, { width: pageW - 36 });

	const metaY = doc.page.margins.top + 76;
	const generatedAt = dateTimeText(new Date());
	// Evitar caracteres unicode que algunas fuentes PDF no renderizan bien.
	const rangeText = firstDay && lastDay ? `${firstDay} a ${lastDay}` : '—';

	// Meta cards
	const gap = 14;
	const leftW = Math.min(370, Math.floor(pageW * 0.62));
	const rightW = pageW - leftW - gap;

	drawCard(doc, { x: pageX, y: metaY - 6, w: leftW, h: 118, fill: '#ffffff', stroke: '#e5e7eb' });
	drawCard(doc, { x: pageX + leftW + gap, y: metaY - 6, w: rightW, h: 118, fill: '#ffffff', stroke: '#e5e7eb' });

	drawSectionTitle(doc, { x: pageX + 14, y: metaY + 6, title: 'Contexto', accentColor: accent });
	drawKeyValue(doc, { x: pageX + 14, y: metaY + 30, w: leftW - 28, key: 'Sucursal', value: branchName });
	drawKeyValue(doc, { x: pageX + 14, y: metaY + 74, w: leftW - 28, key: 'Rango', value: rangeText });

	drawSectionTitle(doc, { x: pageX + leftW + gap + 14, y: metaY + 6, title: 'Generación', accentColor: accent });
	drawKeyValue(doc, {
		x: pageX + leftW + gap + 14,
		y: metaY + 30,
		w: rightW - 28,
		key: 'Generado',
		value: generatedAt,
	});
	drawKeyValue(doc, {
		x: pageX + leftW + gap + 14,
		y: metaY + 74,
		w: rightW - 28,
		key: 'Fuente',
		value: 'Base de datos (analytics)',
	});

	// Totales
	const totalsY = metaY + 132;
	drawCard(doc, { x: pageX, y: totalsY - 6, w: pageW, h: 184, fill: '#ffffff', stroke: '#e5e7eb' });
	drawSectionTitle(doc, { x: pageX + 14, y: totalsY + 6, title: 'Resumen (totales)', accentColor: accent });

	const t = totals || {};
	const cols = 4;
	const rows = 2;
	const cellW = Math.floor((pageW - 28) / cols);
	const cellH = 64;
	const keys = [
		{ label: 'Tumbas', value: formatInt(t.graves_created || 0) },
		{ label: 'Difuntos', value: formatInt(t.deceased_created || 0) },
		{ label: 'Entierros', value: formatInt(t.burials_created || 0) },
		{ label: 'Reservas', value: formatInt(t.reservations_created || 0) },
		{ label: 'Pagos', value: formatInt(t.payments_created || 0) },
		{ label: 'Pagos pagados', value: formatInt(t.payments_paid || 0) },
		{ label: 'Reseñas', value: formatInt(t.reviews_count || 0) },
		{ label: 'Prom. reseñas', value: formatDec2(t.reviews_avg_rating || 0) },
	];

	for (let i = 0; i < keys.length; i++) {
		const cx = pageX + 14 + (i % cols) * cellW;
		const cy = totalsY + 30 + Math.floor(i / cols) * cellH;
		doc.save();
		doc.fillColor('#64748b').font('Helvetica').fontSize(9).text(keys[i].label, cx, cy, { width: cellW - 10 });
		doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(18).text(String(keys[i].value), cx, cy + 16, { width: cellW - 10 });
		doc.restore();
	}

	// Interpretación rápida (1 línea, minimalista)
	const d = Number(days) || 0;
	const avgReservations = d > 0 ? Number(t.reservations_created || 0) / d : 0;
	const avgPaid = d > 0 ? Number(t.payments_paid || 0) / d : 0;
	const paidRate = Number(t.payments_created || 0) > 0 ? Number(t.payments_paid || 0) / Number(t.payments_created || 0) : NaN;
	const quickText = `Promedios diarios: Reservas ${formatDec2(avgReservations)}/día · Pagos pagados ${formatDec2(avgPaid)}/día · Tasa de pago ${Number.isFinite(paidRate) ? formatPct01(paidRate) : '—'}`;
	doc.save();
	doc.fillColor('#64748b').font('Helvetica').fontSize(9).text(quickText, pageX + 14, totalsY + 30 + rows * cellH + 8, { width: pageW - 28 });
	doc.restore();

	// Mini gráfico (últimos 30 días) para reservas y pagos pagados
	const chartY = totalsY + 198;
	const chartH = 148;
	drawCard(doc, { x: pageX, y: chartY - 6, w: pageW, h: chartH, fill: '#f8fafc', stroke: '#e5e7eb' });
	drawSectionTitle(doc, { x: pageX + 14, y: chartY + 6, title: 'Tendencia (últimos 30 días)', accentColor: accent });

	const last30 = Array.isArray(series) ? series.slice(-30) : [];
	const reservations = last30.map((r) => Number(r?.reservations_created || 0));
	const paymentsPaid = last30.map((r) => Number(r?.payments_paid || 0));
	const maxReservations = reservations.length ? Math.max(...reservations) : 0;
	const maxPaid = paymentsPaid.length ? Math.max(...paymentsPaid) : 0;

	const halfW = Math.floor((pageW - 28 - gap) / 2);
	const barsH = 70;
	const barsY = chartY + 38;

	doc.save();
	doc.fillColor('#334155').font('Helvetica').fontSize(9).text(`Reservas (máx. ${formatInt(maxReservations)})`, pageX + 14, chartY + 26, { width: halfW });
	doc.fillColor('#334155').font('Helvetica').fontSize(9).text(`Pagos pagados (máx. ${formatInt(maxPaid)})`, pageX + 14 + halfW + gap, chartY + 26, { width: halfW });
	doc.restore();

	drawMiniBars(doc, { x: pageX + 14, y: barsY, w: halfW, h: barsH, values: reservations, color: accent });
	drawMiniBars(doc, { x: pageX + 14 + halfW + gap, y: barsY, w: halfW, h: barsH, values: paymentsPaid, color: '#16a34a' });

	doc.save();
	doc.fillColor('#64748b')
		.font('Helvetica')
		.fontSize(8)
		.text('Barras normalizadas (comparación visual).', pageX + 14, barsY + barsH + 10, { width: pageW - 28 });
	doc.restore();

	// Tabla diaria (con paginado)
	if (!Array.isArray(series) || series.length === 0) {
		drawFooter();
		doc.end();
		return;
	}

	drawFooter();
	doc.addPage();

	const tableX = pageX;
	let tableY = doc.page.margins.top;
	const rowH = 18;
	const colWidths = {
		day: 86,
		graves: 66,
		res: 66,
		paid: 78,
		reviews: 66,
		avg: 70,
	};
	const colsOrder = ['day', 'graves', 'res', 'paid', 'reviews', 'avg'];
	const headers = {
		day: 'Día',
		graves: 'Tumbas',
		res: 'Reservas',
		paid: 'Pagos pag.',
		reviews: 'Reseñas',
		avg: 'Prom.',
	};

	function drawTableHeader() {
		doc.save();
		doc.roundedRect(tableX, tableY, pageW, rowH + 6, 8).fill('#0f172a');
		doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
		let x = tableX + 10;
		for (const k of colsOrder) {
			doc.text(headers[k], x, tableY + 6, { width: colWidths[k], align: k === 'day' ? 'left' : 'right' });
			x += colWidths[k];
		}
		doc.restore();
		tableY += rowH + 10;
	}

	function ensurePageSpace() {
		const bottom = doc.page.height - doc.page.margins.bottom;
		if (tableY + rowH > bottom) {
			drawFooter();
			doc.addPage();
			tableY = doc.page.margins.top;
			drawTableHeader();
		}
	}

	// Título tabla
	doc.save();
	doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(`Detalle diario · ${safeText(branchName)}`, pageX, tableY);
	doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`Rango: ${rangeText}`, pageX, tableY + 18);
	doc.restore();
	tableY += 44;

	drawTableHeader();

	const rowsData = Array.isArray(series) ? series : [];
	for (let i = 0; i < rowsData.length; i++) {
		ensurePageSpace();
		const r = rowsData[i] || {};
		const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
		doc.save();
		doc.rect(tableX, tableY - 2, pageW, rowH).fill(bg);
		doc.fillColor('#0f172a').font('Helvetica').fontSize(9);

		let x = tableX + 10;
		const cells = {
			day: safeText(r.day, ''),
			graves: formatInt(r.graves_created || 0),
			res: formatInt(r.reservations_created || 0),
			paid: formatInt(r.payments_paid || 0),
			reviews: formatInt(r.reviews_count || 0),
			avg: formatDec2(r.reviews_avg_rating || 0),
		};
		for (const k of colsOrder) {
			doc.text(cells[k], x, tableY + 2, { width: colWidths[k], align: k === 'day' ? 'left' : 'right' });
			x += colWidths[k];
		}
		doc.restore();
		tableY += rowH;
	}

	// Footer (última página)
	drawFooter();

	doc.end();
}

module.exports = {
	writeBranchAnalyticsPdf,
};

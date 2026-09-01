/**
 * Statement as a real PDF.
 *
 * Built programmatically rather than by screenshotting the printed sheet: the
 * text stays selectable and searchable, it renders crisply at any zoom, and
 * the file comes out tens of kilobytes instead of the megabytes a rasterised
 * page would cost — which matters when it is going over WhatsApp.
 *
 * jsPDF is ~300KB, so this module is only ever loaded through a dynamic
 * import. Nobody who never sends a statement pays for it.
 */

import type { ClientStatement } from './calc'
import { formatCentsPlain } from './money'
import { formatDateForHumans } from './whatsapp'
import {
  PAYMENT_METHOD_LABELS,
  type BusinessProfile,
  type Client,
  type Invoice,
  type Order,
} from '../types/domain'

/** Colours lifted from the printed sheet so the two documents match. */
const BANNER: [number, number, number] = [1, 95, 66]
const ROW_TOTAL: [number, number, number] = [242, 219, 219]
const ROW_PAID: [number, number, number] = [0, 176, 80]
const ROW_BALANCE: [number, number, number] = [255, 0, 0]
const CELL_TINT: [number, number, number] = [218, 238, 243]

const MARGIN = 14

export interface StatementPdfInput {
  client: Client
  statement: ClientStatement
  orders: Order[]
  invoices: Invoice[]
  profile: BusinessProfile | null
  today: string
}

/** Render the statement and hand back a PDF file ready to share or download. */
export async function buildStatementPdf({
  client,
  statement,
  orders,
  invoices,
  profile,
  today,
}: StatementPdfInput): Promise<File> {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const titleOf = (orderId: string) =>
    orders.find((o) => o.id === orderId)?.title ?? '—'

  // Banner
  doc.setFillColor(...BANNER)
  doc.rect(0, 0, pageWidth, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text((profile?.businessName || 'Statement').toUpperCase(), pageWidth / 2, 13, {
    align: 'center',
  })
  if (profile?.tagline) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(10)
    doc.text(profile.tagline, pageWidth / 2, 20, { align: 'center' })
  }

  // Heading and contact block
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Statement of account', MARGIN, 38)

  const contact: [string, string][] = []
  if (profile?.email) contact.push(['Mail', profile.email])
  if (profile?.mobile) contact.push(['Mobile', profile.mobile])
  contact.push(['Date', formatDateForHumans(today)])

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  contact.forEach(([label, value], i) => {
    const y = 34 + i * 5
    doc.setFont('helvetica', 'bold')
    doc.text(`${label} :`, pageWidth - MARGIN - 55, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, pageWidth - MARGIN - 38, y)
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('M/S :', MARGIN, 48)
  doc.text(client.name, MARGIN + 14, 48)

  // Outstanding work
  autoTable(doc, {
    startY: 54,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Order', 'Invoice', 'Due', 'Amount', 'Paid', 'Balance']],
    body: statement.lines.map((line) => [
      titleOf(line.invoice.orderId),
      line.invoice.label,
      formatDateForHumans(line.invoice.dueDate) +
        (line.bucket === 'overdue' ? ' *' : ''),
      formatCentsPlain(line.invoice.amountDueCents),
      line.paidCents > 0 ? formatCentsPlain(line.paidCents) : '-',
      line.balanceCents > 0 ? formatCentsPlain(line.balanceCents) : '-',
    ]),
    foot: [
      ['', '', '', '', 'Total invoiced', formatCentsPlain(statement.totalInvoicedCents)],
      ['', '', '', '', 'Paid', formatCentsPlain(statement.totalPaidCents)],
      ['', '', '', '', 'Balance due', formatCentsPlain(Math.max(statement.balanceDueCents, 0))],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [0, 0, 0] },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', fillColor: CELL_TINT },
    },
    footStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' },
    // The three summary rows carry the same colours as the printed sheet.
    didParseCell: (data) => {
      if (data.section !== 'foot') return
      const palette = [ROW_TOTAL, ROW_PAID, ROW_BALANCE][data.row.index]
      if (!palette) return

      if (data.column.index < 5) {
        data.cell.styles.fillColor = palette
        data.cell.styles.textColor = data.row.index === 0 ? [0, 0, 0] : [255, 255, 255]
      } else {
        data.cell.styles.fillColor = CELL_TINT
      }
    },
  })

  let cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  if (statement.overdueCount > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(185, 28, 28)
    doc.text(
      `* overdue — ${statement.overdueCount === 1 ? '1 invoice is' : `${statement.overdueCount} invoices are`} past the due date.`,
      MARGIN,
      cursorY + 5,
    )
    cursorY += 5
    doc.setTextColor(0, 0, 0)
  }

  // Payments already received
  if (statement.payments.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...BANNER)
    doc.text('Payments received', MARGIN, cursorY + 12)
    doc.setTextColor(0, 0, 0)

    autoTable(doc, {
      startY: cursorY + 15,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Date', 'Against', 'Method', 'Amount']],
      body: statement.payments.map((payment) => {
        const against = invoices.find((i) => i.id === payment.invoiceId)
        return [
          formatDateForHumans(payment.paidOn),
          `${titleOf(payment.orderId)}${against ? ` — ${against.label}` : ''}`,
          PAYMENT_METHOD_LABELS[payment.method] +
            (payment.reference ? ` · ${payment.reference}` : ''),
          formatCentsPlain(payment.amountCents),
        ]
      }),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.6, textColor: [0, 0, 0] },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: { 3: { halign: 'right', fillColor: CELL_TINT } },
    })

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  }

  if (profile?.thankYouNote) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(profile.thankYouNote, MARGIN, cursorY + 10)
  }

  // Footer band, pinned to the bottom of the last page.
  if (profile?.footerNote) {
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFillColor(...BANNER)
    doc.rect(0, pageHeight - 20, pageWidth, 20, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(7.5)
    doc.text(doc.splitTextToSize(profile.footerNote, pageWidth - MARGIN * 2), pageWidth / 2, pageHeight - 13, {
      align: 'center',
    })
  }

  const blob = doc.output('blob')
  return new File([blob], statementFileName(client, today), {
    type: 'application/pdf',
  })
}

/** 'Statement-Burger-Craft-2026-09-01.pdf'. */
export function statementFileName(client: Client, today: string): string {
  const safeName = client.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `Statement-${safeName}-${today}.pdf`
}

/**
 * Hand the file to the operating system's share sheet, so the freelancer can
 * pick WhatsApp and send it as an attachment.
 *
 * A wa.me link cannot carry a file — WhatsApp's URL scheme is text only — so
 * this is the only route to an attached PDF without a paid Business API.
 * Returns false when the browser cannot share files (most desktops), leaving
 * the caller to fall back to a download.
 */
export async function shareFile(file: File, text: string): Promise<boolean> {
  const shareData = { files: [file], text }

  if (typeof navigator.canShare !== 'function' || !navigator.canShare(shareData)) {
    return false
  }

  try {
    await navigator.share(shareData)
    return true
  } catch (cause) {
    // The user dismissing the share sheet is not a failure worth reporting.
    if (cause instanceof DOMException && cause.name === 'AbortError') return true
    return false
  }
}

/** Fallback for browsers that cannot share files: save it, then attach by hand. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  URL.revokeObjectURL(url)
}

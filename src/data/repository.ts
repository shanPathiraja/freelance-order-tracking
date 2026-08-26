/**
 * Firestore access layer. Every read is filtered by ownerId and every write
 * stamps it, so the security rules and the client agree on who owns what.
 *
 * Deliberately dumb: no caching, no derived state. Totals are computed in
 * lib/calc.ts from whatever these functions return, which keeps the money
 * logic testable without a database.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

import { db } from '../lib/firebase'
import type {
  BusinessProfile,
  Client,
  Invoice,
  Order,
  Transaction,
} from '../types/domain'

export const COLLECTIONS = {
  clients: 'clients',
  orders: 'orders',
  invoices: 'invoices',
  transactions: 'transactions',
  settings: 'settings',
} as const

/** Fields the caller supplies; id/ownerId/createdAt are filled in here. */
type NewRecord<T> = Omit<T, 'id' | 'ownerId' | 'createdAt'>

async function listOwned<T>(
  collectionName: string,
  ownerId: string,
): Promise<T[]> {
  const snapshot = await getDocs(
    query(collection(db, collectionName), where('ownerId', '==', ownerId)),
  )

  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
}

async function createOwned<T>(
  collectionName: string,
  ownerId: string,
  data: NewRecord<T>,
): Promise<string> {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    ownerId,
    createdAt: Date.now(),
  })

  return ref.id
}

export const clients = {
  list: (ownerId: string) => listOwned<Client>(COLLECTIONS.clients, ownerId),
  create: (ownerId: string, data: NewRecord<Client>) =>
    createOwned<Client>(COLLECTIONS.clients, ownerId, data),
  update: (id: string, data: Partial<NewRecord<Client>>) =>
    updateDoc(doc(db, COLLECTIONS.clients, id), data),
}

export const orders = {
  list: (ownerId: string) => listOwned<Order>(COLLECTIONS.orders, ownerId),
  create: (ownerId: string, data: NewRecord<Order>) =>
    createOwned<Order>(COLLECTIONS.orders, ownerId, data),
  update: (id: string, data: Partial<NewRecord<Order>>) =>
    updateDoc(doc(db, COLLECTIONS.orders, id), data),
}

export const invoices = {
  list: (ownerId: string) => listOwned<Invoice>(COLLECTIONS.invoices, ownerId),
  create: (ownerId: string, data: NewRecord<Invoice>) =>
    createOwned<Invoice>(COLLECTIONS.invoices, ownerId, data),
  update: (id: string, data: Partial<NewRecord<Invoice>>) =>
    updateDoc(doc(db, COLLECTIONS.invoices, id), data),

  /** Raise several invoices at once — the two halves of a 50/50 split. */
  createMany: async (ownerId: string, records: NewRecord<Invoice>[]) => {
    const batch = writeBatch(db)
    const createdAt = Date.now()

    for (const record of records) {
      batch.set(doc(collection(db, COLLECTIONS.invoices)), {
        ...record,
        ownerId,
        createdAt,
      })
    }

    await batch.commit()
  },
}

export const transactions = {
  list: (ownerId: string) =>
    listOwned<Transaction>(COLLECTIONS.transactions, ownerId),
  create: (ownerId: string, data: NewRecord<Transaction>) =>
    createOwned<Transaction>(COLLECTIONS.transactions, ownerId, data),
  update: (id: string, data: Partial<NewRecord<Transaction>>) =>
    updateDoc(doc(db, COLLECTIONS.transactions, id), data),
  remove: (id: string) => deleteDoc(doc(db, COLLECTIONS.transactions, id)),
}

/**
 * The freelancer's own business details, printed on invoices. One document per
 * owner, keyed by uid so the security rules can match on the document id alone.
 */
export const businessProfile = {
  async get(ownerId: string): Promise<BusinessProfile | null> {
    const snapshot = await getDoc(doc(db, COLLECTIONS.settings, ownerId))
    return snapshot.exists() ? (snapshot.data() as BusinessProfile) : null
  },

  save: (ownerId: string, profile: BusinessProfile) =>
    setDoc(doc(db, COLLECTIONS.settings, ownerId), { ...profile, ownerId }),
}

/**
 * Everything the app needs, in five queries. The dataset is one freelancer's
 * book of work — a few hundred records — so loading it whole and computing
 * totals in memory is simpler and cheaper than maintaining running aggregates,
 * and it keeps well inside the Spark plan's daily read allowance.
 */
export async function loadWorkspace(ownerId: string) {
  const [clientList, orderList, invoiceList, transactionList, profile] =
    await Promise.all([
      clients.list(ownerId),
      orders.list(ownerId),
      invoices.list(ownerId),
      transactions.list(ownerId),
      businessProfile.get(ownerId),
    ])

  return {
    clients: clientList,
    orders: orderList,
    invoices: invoiceList,
    transactions: transactionList,
    profile,
  }
}

export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>

export const EMPTY_WORKSPACE: Workspace = {
  clients: [],
  orders: [],
  invoices: [],
  transactions: [],
  profile: null,
}

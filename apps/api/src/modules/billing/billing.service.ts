import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';

@Injectable()
export class BillingService {
 constructor(private readonly tenant: TenantContextService) {}
 async createContract(userId: string, dto: { child_id:string; monthly_base_amount:number; start_date:string; end_date?:string; schedule_type?:string; discount_percent?:number }) {
  const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
   const child=await c.query(`SELECT id FROM children WHERE id=$1 AND deleted_at IS NULL`,[dto.child_id]); if(!child.rows[0]) throw Errors.notFound();
   const r=await c.query(`INSERT INTO contracts(organization_id,child_id,monthly_base_amount,start_date,end_date,schedule_type,discount_percent,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[org,dto.child_id,dto.monthly_base_amount,dto.start_date,dto.end_date??null,dto.schedule_type??'full_time',dto.discount_percent??0,userId]); return r.rows[0];
  });
 }
 async generateInvoice(userId:string,dto:{contract_id:string;period_year:number;period_month:number;due_date:string}) {
  const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
   const contract=(await c.query(`SELECT * FROM contracts WHERE id=$1 AND is_active=true`,[dto.contract_id])).rows[0]; if(!contract) throw Errors.notFound();
   const exists=await c.query(`SELECT id FROM invoices WHERE contract_id=$1 AND period_year=$2 AND period_month=$3 AND status <> 'cancelled'`,[dto.contract_id,dto.period_year,dto.period_month]);
   if(exists.rows[0]) throw new AppError('INVOICE_ALREADY_EXISTS','Une facture existe déjà pour cette période','توجد فاتورة بالفعل لهذه الفترة',409);
   const subtotal=Number(contract.monthly_base_amount)+(contract.includes_meals?Number(contract.meal_amount??0):0)+(contract.includes_transport?Number(contract.transport_amount??0):0);
   const discount=Math.round(subtotal*Number(contract.discount_percent??0))/100; const total=subtotal-discount;
   const seq=(await c.query(`SELECT next_org_sequence($1) AS n`,[org])).rows[0].n;
   const invoice=(await c.query(`INSERT INTO invoices(organization_id,invoice_number,child_id,contract_id,period_year,period_month,subtotal,discount_amount,total_amount,due_date,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[org,`FAC-${dto.period_year}${String(dto.period_month).padStart(2,'0')}-${seq}`,contract.child_id,dto.contract_id,dto.period_year,dto.period_month,subtotal,discount,total,dto.due_date,userId])).rows[0];
   await c.query(`INSERT INTO invoice_lines(organization_id,invoice_id,description_fr,description_ar,quantity,unit_price,total_price,line_type) VALUES($1,$2,'Garde mensuelle','الرعاية الشهرية',1,$3,$3,'care')`,[org,invoice.id,subtotal]);
   await c.query(`INSERT INTO background_jobs(organization_id,job_type,payload,priority) VALUES($1,'generate_invoice_pdf',$2,2)`,[org,JSON.stringify({invoice_id:invoice.id})]);
   return invoice;
  });
 }
 async recordCashPayment(userId:string,dto:{invoice_id:string;amount:number;notes?:string}) {
  const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
   const invoice=(await c.query(`SELECT id,child_id,total_amount,paid_amount,status FROM invoices WHERE id=$1 FOR UPDATE`,[dto.invoice_id])).rows[0];
   if(!invoice) throw Errors.notFound();
   if(['paid','cancelled'].includes(invoice.status)) throw new AppError('INVOICE_IMMUTABLE','Cette facture ne peut plus recevoir de paiement','لا يمكن دفع هذه الفاتورة',422);
   const due=Number(invoice.total_amount)-Number(invoice.paid_amount); if(dto.amount>due) throw new AppError('PAYMENT_EXCEEDS_BALANCE','Le paiement dépasse le solde de la facture','الدفعة تتجاوز رصيد الفاتورة',422);
   const seq=(await c.query(`SELECT next_org_sequence($1) AS n`,[org])).rows[0].n;
   const payment=(await c.query(`INSERT INTO payments(organization_id,reference_number,receipt_number,child_id,amount,method,status,received_at,confirmed_at,notes,created_by)
    VALUES($1,$2,$3,$4,$5,'cash','confirmed',NOW(),NOW(),$6,$7) RETURNING id,reference_number,receipt_number,amount,status`,[org,`PAY-${seq}`,`REC-${seq}`,invoice.child_id,dto.amount,dto.notes??null,userId])).rows[0];
   await c.query(`INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by) VALUES($1,$2,$3,$4,$5)`,[org,payment.id,invoice.id,dto.amount,userId]);
   const updated=(await c.query(`UPDATE invoices SET paid_amount=paid_amount+$2,status=CASE WHEN paid_amount+$2=total_amount THEN 'paid' ELSE 'sent' END,updated_at=NOW() WHERE id=$1 RETURNING paid_amount,balance,status`,[invoice.id,dto.amount])).rows[0];
   return {...payment,invoice:updated};
  });
 }
 async openCashRegister(_userId:string,dto:{site_id:string;opening_balance?:number}) { const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
  const site=await c.query(`SELECT id FROM sites WHERE id=$1`,[dto.site_id]); if(!site.rows[0]) throw Errors.notFound();
  const date=(await c.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d;
  const r=await c.query(`INSERT INTO daily_cash_registers(organization_id,site_id,register_date,opening_balance) VALUES($1,$2,$3,$4) ON CONFLICT(site_id,register_date) DO NOTHING RETURNING *`,[org,dto.site_id,date,dto.opening_balance??0]);
  if(!r.rows[0]) throw new AppError('CASH_REGISTER_ALREADY_OPEN','La caisse est déjà ouverte','الصندوق مفتوح بالفعل',409); return r.rows[0];
 }); }
 async closeCashRegister(userId:string,dto:{site_id:string;notes?:string}) { const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
  const date=(await c.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d;
  const register=(await c.query(`SELECT * FROM daily_cash_registers WHERE site_id=$1 AND register_date=$2 FOR UPDATE`,[dto.site_id,date])).rows[0]; if(!register) throw new AppError('CASH_REGISTER_NOT_OPEN','La caisse n’est pas ouverte','الصندوق غير مفتوح',409); if(register.closed_at) throw new AppError('CASH_REGISTER_CLOSED','La caisse est déjà clôturée','الصندوق مغلق بالفعل',409);
  const total=(await c.query(`SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p JOIN children ch ON ch.id=p.child_id WHERE p.organization_id=$1 AND p.method='cash' AND p.status='confirmed' AND ch.site_id=$2 AND (p.confirmed_at AT TIME ZONE 'Africa/Algiers')::date=$3`,[org,dto.site_id,date])).rows[0].total;
  return (await c.query(`UPDATE daily_cash_registers SET total_cash_in=$1,closing_balance=opening_balance+$1,closed_at=NOW(),closed_by=$2,notes=$3 WHERE id=$4 RETURNING *`,[total,userId,dto.notes??null,register.id])).rows[0];
 }); }
 async listInvoices(childId?:string) { const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
  const p:unknown[]=[org]; let where=''; if(childId){p.push(childId);where=' AND child_id=$2';} return (await c.query(`SELECT id,invoice_number,child_id,period_year,period_month,total_amount,paid_amount,balance,status,due_date,pdf_url FROM invoices WHERE organization_id=$1${where} ORDER BY created_at DESC`,p)).rows;
 }); }
}

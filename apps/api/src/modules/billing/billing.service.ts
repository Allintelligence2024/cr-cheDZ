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
 async listInvoices(childId?:string) { const org=requireTenant(this.tenant); return this.tenant.withTenantConnection(async c=>{
  const p:unknown[]=[org]; let where=''; if(childId){p.push(childId);where=' AND child_id=$2';} return (await c.query(`SELECT id,invoice_number,child_id,period_year,period_month,total_amount,paid_amount,balance,status,due_date,pdf_url FROM invoices WHERE organization_id=$1${where} ORDER BY created_at DESC`,p)).rows;
 }); }
}

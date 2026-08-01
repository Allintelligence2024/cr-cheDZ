import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateContractDto, GenerateInvoiceDto } from './dto/billing.dto';
import { BillingService } from './billing.service';
@Controller('billing')
export class BillingController {
 constructor(private readonly billing: BillingService) {}
 @Post('contracts') @Roles('director','accountant') contract(@CurrentUser() u:CurrentUserPayload,@Body() d:CreateContractDto){return this.billing.createContract(u.sub,d);}
 @Post('invoices/generate') @Roles('director','accountant') invoice(@CurrentUser() u:CurrentUserPayload,@Body() d:GenerateInvoiceDto){return this.billing.generateInvoice(u.sub,d);}
 @Get('invoices') @Roles('director','accountant') invoices(@Query('child_id') childId?:string){return this.billing.listInvoices(childId);}
}

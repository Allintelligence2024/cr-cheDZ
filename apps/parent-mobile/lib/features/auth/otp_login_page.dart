import 'package:flutter/material.dart';
import '../../core/api_client.dart';

class OtpLoginPage extends StatefulWidget {
  const OtpLoginPage({super.key, required this.api, required this.onAuthenticated});
  final ParentApiClient api;
  final VoidCallback onAuthenticated;
  @override State<OtpLoginPage> createState() => _OtpLoginPageState();
}
class _OtpLoginPageState extends State<OtpLoginPage> {
  final _phone = TextEditingController(); final _code = TextEditingController(); bool _sent=false; bool _busy=false; String? _error;
  Future<void> _request() async { setState(() {_busy=true;_error=null;}); try { await widget.api.requestOtp(_phone.text); setState(()=>_sent=true); } catch (_) { setState(()=>_error='Impossible d’envoyer le code / تعذر إرسال الرمز'); } finally { if(mounted)setState(()=>_busy=false); } }
  Future<void> _verify() async { setState(() {_busy=true;_error=null;}); try { await widget.api.saveSession(await widget.api.verifyOtp(_phone.text,_code.text)); widget.onAuthenticated(); } catch (_) { setState(()=>_error='Code incorrect ou expiré / الرمز غير صحيح أو منتهي'); } finally { if(mounted)setState(()=>_busy=false); } }
  @override Widget build(BuildContext context) => Scaffold(body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420),child: Padding(padding: const EdgeInsets.all(24),child: Column(mainAxisAlignment: MainAxisAlignment.center,children:[Text('Crèche DZ',style:Theme.of(context).textTheme.headlineMedium),const SizedBox(height:24),TextField(controller:_phone,keyboardType:TextInputType.phone,decoration:const InputDecoration(labelText:'Téléphone / الهاتف',prefixIcon:Icon(Icons.phone))),if(_sent)...[const SizedBox(height:12),TextField(controller:_code,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'Code à 6 chiffres / رمز من 6 أرقام'))],if(_error!=null) Padding(padding:const EdgeInsets.only(top:12),child:Text(_error!,style:const TextStyle(color:Colors.red))),const SizedBox(height:20),FilledButton(onPressed:_busy?null:(_sent?_verify:_request),child:Text(_busy?'…':_sent?'Valider / تأكيد':'Recevoir un code / استلام رمز'))])))));
}

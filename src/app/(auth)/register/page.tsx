import { smsEnabled } from "@/lib/sms";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return <RegisterForm smsEnabled={smsEnabled()} />;
}

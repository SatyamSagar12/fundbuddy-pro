import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Client = {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  address: string | null;
  pan: string | null;
  nominee_name: string | null;
  nominee_dob: string | null;
  dob: string | null;
  bank_account_no: string | null;
  bank_name: string | null;
  ifsc_code: string | null;
  micr_code: string | null;
  branch_name: string | null;
  nominee_pan: string | null;
  nominee_mobile: string | null;
  nominee_email: string | null;
  nominee_relation: string | null;
  created_at: string;
};

export type Investment = {
  id: string;
  client_id: string;
  scheme: string;
  type: string;
  amount: number;
  date: string;
  payment_mode: string;
  transaction_id: string | null;
};

export type Sip = {
  id: string;
  client_id: string;
  scheme: string;
  amount: number;
  frequency: string;
  start_date: string;
  status: string;
};

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

export const clientsQuery = queryOptions({
  queryKey: ["clients"],
  queryFn: async () =>
    unwrap<Client[]>(
      (await supabase.from("clients").select("*").order("created_at", { ascending: false })) as never,
    ),
});

export const investmentsQuery = queryOptions({
  queryKey: ["investments"],
  queryFn: async () =>
    unwrap<Investment[]>(
      (await supabase.from("investments").select("*").order("date", { ascending: false })) as never,
    ),
});

export const sipsQuery = queryOptions({
  queryKey: ["sips"],
  queryFn: async () =>
    unwrap<Sip[]>(
      (await supabase.from("sips").select("*").order("start_date", { ascending: false })) as never,
    ),
});

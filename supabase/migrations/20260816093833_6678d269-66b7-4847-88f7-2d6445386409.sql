CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text NOT NULL,
  email text,
  address text,
  pan text,
  nominee_name text,
  nominee_dob date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors manage clients" ON public.clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scheme text NOT NULL,
  type text NOT NULL DEFAULT 'One-time',
  amount numeric(14,2) NOT NULL,
  date date NOT NULL DEFAULT current_date,
  payment_mode text NOT NULL DEFAULT 'Online',
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investments TO authenticated;
GRANT ALL ON public.investments TO service_role;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors manage investments" ON public.investments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.sips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scheme text NOT NULL,
  amount numeric(14,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'Monthly',
  start_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sips TO authenticated;
GRANT ALL ON public.sips TO service_role;
ALTER TABLE public.sips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advisors manage sips" ON public.sips FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Own profile write" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TYPE public.app_role AS ENUM ('admin', 'advisor');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Roles readable" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name', NEW.email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'advisor')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.clients (id, name, mobile, email, address, pan, nominee_name, nominee_dob) VALUES
 ('11111111-1111-1111-1111-111111111111','Rahul Sharma','9876543210','rahul.sharma@example.com','12 MG Road, Pune','ABCDE1234F','Anita Sharma','1985-04-12'),
 ('22222222-2222-2222-2222-222222222222','Priya Menon','9812345678','priya.menon@example.com','44 Marine Drive, Kochi','PQRSX5678L','Arjun Menon','1990-11-02'),
 ('33333333-3333-3333-3333-333333333333','Amit Verma','9900112233','amit.verma@example.com','7 Sector 21, Noida','LMNOP9012K','Sunita Verma','1979-06-25'),
 ('44444444-4444-4444-4444-444444444444','Sneha Iyer','9765432109','sneha.iyer@example.com','89 Anna Nagar, Chennai','QWERT3456Z','Ravi Iyer','1992-01-19');

INSERT INTO public.investments (client_id, scheme, type, amount, date, payment_mode, transaction_id) VALUES
 ('11111111-1111-1111-1111-111111111111','HDFC Flexi Cap Fund','One-time',150000,'2026-01-15','Online','TXN10001'),
 ('11111111-1111-1111-1111-111111111111','ICICI Bluechip Fund','SIP',5000,'2026-02-05','Online','TXN10002'),
 ('22222222-2222-2222-2222-222222222222','SBI Small Cap Fund','One-time',80000,'2026-02-20','Cheque','TXN10003'),
 ('22222222-2222-2222-2222-222222222222','Axis Midcap Fund','SIP',7500,'2026-03-01','Online','TXN10004'),
 ('33333333-3333-3333-3333-333333333333','Nippon Growth Fund','One-time',250000,'2026-03-11','Online','TXN10005'),
 ('33333333-3333-3333-3333-333333333333','Kotak Emerging Equity','SIP',10000,'2026-04-02','Online','TXN10006'),
 ('44444444-4444-4444-4444-444444444444','Mirae Asset Large Cap','One-time',60000,'2026-04-18','Cheque','TXN10007'),
 ('44444444-4444-4444-4444-444444444444','UTI Nifty Index Fund','SIP',3000,'2026-05-06','Online','TXN10008');

INSERT INTO public.sips (client_id, scheme, amount, frequency, start_date, status) VALUES
 ('11111111-1111-1111-1111-111111111111','ICICI Bluechip Fund',5000,'Monthly','2026-02-05','Active'),
 ('22222222-2222-2222-2222-222222222222','Axis Midcap Fund',7500,'Monthly','2026-03-01','Active'),
 ('33333333-3333-3333-3333-333333333333','Kotak Emerging Equity',10000,'Quarterly','2026-04-02','Paused'),
 ('44444444-4444-4444-4444-444444444444','UTI Nifty Index Fund',3000,'Monthly','2026-05-06','Active');
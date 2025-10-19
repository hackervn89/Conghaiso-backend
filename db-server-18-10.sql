--
-- PostgreSQL database dump
--

\restrict eaA3ETT3u52SBPWGvsyKfcqROAGXEhbnzU2NJeeXqaB7u5B1ayMV4t69Cy7KRT8

-- Dumped from database version 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 17.6

-- Started on 2025-10-18 23:04:50

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16780)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 3666 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- TOC entry 882 (class 1247 OID 16792)
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: hoangviet
--

CREATE TYPE public.attendance_status AS ENUM (
    'pending',
    'present',
    'absent',
    'absent_with_reason',
    'delegated'
);


ALTER TYPE public.attendance_status OWNER TO hoangviet;

--
-- TOC entry 885 (class 1247 OID 16804)
-- Name: participant_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.participant_status AS ENUM (
    'cho_y_kien',
    'da_thong_nhat',
    'da_gop_y'
);


ALTER TYPE public.participant_status OWNER TO postgres;

--
-- TOC entry 888 (class 1247 OID 16812)
-- Name: task_priority; Type: TYPE; Schema: public; Owner: hoangviet
--

CREATE TYPE public.task_priority AS ENUM (
    'normal',
    'important',
    'urgent'
);


ALTER TYPE public.task_priority OWNER TO hoangviet;

--
-- TOC entry 891 (class 1247 OID 16820)
-- Name: task_status; Type: TYPE; Schema: public; Owner: hoangviet
--

CREATE TYPE public.task_status AS ENUM (
    'new',
    'in_progress',
    'completed'
);


ALTER TYPE public.task_status OWNER TO hoangviet;

--
-- TOC entry 894 (class 1247 OID 16828)
-- Name: user_role; Type: TYPE; Schema: public; Owner: hoangviet
--

CREATE TYPE public.user_role AS ENUM (
    'Admin',
    'Secretary',
    'Attendee'
);


ALTER TYPE public.user_role OWNER TO hoangviet;

--
-- TOC entry 256 (class 1255 OID 16835)
-- Name: build_org_tree(integer); Type: FUNCTION; Schema: public; Owner: hoangviet
--

CREATE FUNCTION public.build_org_tree(parent_org_id integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'org_id', o.org_id,
            'org_name', o.org_name,
            'parent_id', o.parent_id,
            'display_order', o.display_order,
            'children', build_org_tree(o.org_id)
        ) ORDER BY o.display_order ASC NULLS LAST, o.org_name ASC
    )
    INTO result
    FROM organizations o
    WHERE o.parent_id IS NOT DISTINCT FROM parent_org_id;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION public.build_org_tree(parent_org_id integer) OWNER TO hoangviet;

--
-- TOC entry 268 (class 1255 OID 16836)
-- Name: build_org_tree_with_users(integer); Type: FUNCTION; Schema: public; Owner: hoangviet
--

CREATE FUNCTION public.build_org_tree_with_users(parent_org_id integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'org_id', o.org_id,
            'org_name', o.org_name,
            'parent_id', o.parent_id,
            'display_order', o.display_order,
            'users', COALESCE(
                (SELECT jsonb_agg(jsonb_build_object('user_id', u.user_id, 'full_name', u.full_name) ORDER BY u.full_name)
                 FROM user_organizations uo
                 JOIN users u ON uo.user_id = u.user_id
                 WHERE uo.org_id = o.org_id),
                '[]'::jsonb
            ),
            'children', build_org_tree_with_users(o.org_id)
        ) ORDER BY o.display_order ASC NULLS LAST, o.org_name ASC
    )
    INTO result
    FROM organizations o
    WHERE o.parent_id IS NOT DISTINCT FROM parent_org_id;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION public.build_org_tree_with_users(parent_org_id integer) OWNER TO hoangviet;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 216 (class 1259 OID 16837)
-- Name: agendas; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.agendas (
    agenda_id integer NOT NULL,
    meeting_id integer NOT NULL,
    title text NOT NULL,
    display_order integer NOT NULL
);


ALTER TABLE public.agendas OWNER TO hoangviet;

--
-- TOC entry 217 (class 1259 OID 16842)
-- Name: agendas_agenda_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.agendas_agenda_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agendas_agenda_id_seq OWNER TO hoangviet;

--
-- TOC entry 3667 (class 0 OID 0)
-- Dependencies: 217
-- Name: agendas_agenda_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.agendas_agenda_id_seq OWNED BY public.agendas.agenda_id;


--
-- TOC entry 218 (class 1259 OID 16843)
-- Name: documents; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.documents (
    doc_id integer NOT NULL,
    agenda_id integer NOT NULL,
    doc_name character varying(255) NOT NULL,
    file_path character varying(512)
);


ALTER TABLE public.documents OWNER TO hoangviet;

--
-- TOC entry 219 (class 1259 OID 16848)
-- Name: documents_doc_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.documents_doc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.documents_doc_id_seq OWNER TO hoangviet;

--
-- TOC entry 3668 (class 0 OID 0)
-- Dependencies: 219
-- Name: documents_doc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.documents_doc_id_seq OWNED BY public.documents.doc_id;


--
-- TOC entry 220 (class 1259 OID 16849)
-- Name: draft_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.draft_attachments (
    id integer NOT NULL,
    draft_id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(512) NOT NULL,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.draft_attachments OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16855)
-- Name: draft_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.draft_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.draft_attachments_id_seq OWNER TO postgres;

--
-- TOC entry 3670 (class 0 OID 0)
-- Dependencies: 221
-- Name: draft_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.draft_attachments_id_seq OWNED BY public.draft_attachments.id;


--
-- TOC entry 222 (class 1259 OID 16856)
-- Name: draft_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.draft_comments (
    id integer NOT NULL,
    draft_id integer NOT NULL,
    user_id integer NOT NULL,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.draft_comments OWNER TO postgres;

--
-- TOC entry 3672 (class 0 OID 0)
-- Dependencies: 222
-- Name: TABLE draft_comments; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.draft_comments IS 'Lưu trữ các ý kiến góp ý cho dự thảo.';


--
-- TOC entry 223 (class 1259 OID 16862)
-- Name: draft_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.draft_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.draft_comments_id_seq OWNER TO postgres;

--
-- TOC entry 3674 (class 0 OID 0)
-- Dependencies: 223
-- Name: draft_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.draft_comments_id_seq OWNED BY public.draft_comments.id;


--
-- TOC entry 224 (class 1259 OID 16863)
-- Name: draft_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.draft_documents (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    document_number character varying(100),
    creator_id integer NOT NULL,
    status character varying(50) DEFAULT 'dang_lay_y_kien'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deadline timestamp with time zone
);


ALTER TABLE public.draft_documents OWNER TO postgres;

--
-- TOC entry 3676 (class 0 OID 0)
-- Dependencies: 224
-- Name: TABLE draft_documents; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.draft_documents IS 'Lưu thông tin chính của các dự thảo văn bản cần lấy ý kiến.';


--
-- TOC entry 3677 (class 0 OID 0)
-- Dependencies: 224
-- Name: COLUMN draft_documents.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.draft_documents.status IS 'Trạng thái của luồng góp ý: đang_lay_y_kien, hoan_thanh, da_huy';


--
-- TOC entry 3678 (class 0 OID 0)
-- Dependencies: 224
-- Name: COLUMN draft_documents.deadline; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.draft_documents.deadline IS 'Thời hạn người tham gia phải đưa ra ý kiến.';


--
-- TOC entry 225 (class 1259 OID 16869)
-- Name: draft_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.draft_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.draft_documents_id_seq OWNER TO postgres;

--
-- TOC entry 3680 (class 0 OID 0)
-- Dependencies: 225
-- Name: draft_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.draft_documents_id_seq OWNED BY public.draft_documents.id;


--
-- TOC entry 226 (class 1259 OID 16870)
-- Name: draft_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.draft_participants (
    id integer NOT NULL,
    draft_id integer NOT NULL,
    user_id integer NOT NULL,
    status public.participant_status DEFAULT 'cho_y_kien'::public.participant_status,
    response_at timestamp with time zone,
    confirmation_hash character varying(255)
);


ALTER TABLE public.draft_participants OWNER TO postgres;

--
-- TOC entry 3682 (class 0 OID 0)
-- Dependencies: 226
-- Name: TABLE draft_participants; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.draft_participants IS 'Quản lý người tham gia góp ý cho mỗi dự thảo.';


--
-- TOC entry 3683 (class 0 OID 0)
-- Dependencies: 226
-- Name: COLUMN draft_participants.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.draft_participants.status IS 'Trạng thái phản hồi của người tham gia: cho_y_kien, da_thong_nhat, da_gop_y';


--
-- TOC entry 227 (class 1259 OID 16874)
-- Name: draft_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.draft_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.draft_participants_id_seq OWNER TO postgres;

--
-- TOC entry 3685 (class 0 OID 0)
-- Dependencies: 227
-- Name: draft_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.draft_participants_id_seq OWNED BY public.draft_participants.id;


--
-- TOC entry 228 (class 1259 OID 16875)
-- Name: meeting_attendees; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.meeting_attendees (
    meeting_id integer NOT NULL,
    user_id integer NOT NULL,
    status public.attendance_status DEFAULT 'pending'::public.attendance_status NOT NULL,
    check_in_time timestamp with time zone,
    qr_code_token text,
    represented_by_user_id integer,
    is_delegated boolean DEFAULT false NOT NULL
);


ALTER TABLE public.meeting_attendees OWNER TO hoangviet;

--
-- TOC entry 3687 (class 0 OID 0)
-- Dependencies: 228
-- Name: COLUMN meeting_attendees.is_delegated; Type: COMMENT; Schema: public; Owner: hoangviet
--

COMMENT ON COLUMN public.meeting_attendees.is_delegated IS 'Đánh dấu TRUE nếu người này tham dự với tư cách là người được ủy quyền.';


--
-- TOC entry 229 (class 1259 OID 16882)
-- Name: meetings; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.meetings (
    meeting_id integer NOT NULL,
    title text NOT NULL,
    location text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    creator_id integer,
    org_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    chairperson_id integer,
    meeting_secretary_id integer,
    qr_code_token text
);


ALTER TABLE public.meetings OWNER TO hoangviet;

--
-- TOC entry 230 (class 1259 OID 16889)
-- Name: meetings_meeting_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.meetings_meeting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.meetings_meeting_id_seq OWNER TO hoangviet;

--
-- TOC entry 3688 (class 0 OID 0)
-- Dependencies: 230
-- Name: meetings_meeting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.meetings_meeting_id_seq OWNED BY public.meetings.meeting_id;


--
-- TOC entry 231 (class 1259 OID 16890)
-- Name: organization_leaders; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.organization_leaders (
    user_id integer NOT NULL,
    org_id integer NOT NULL,
    leader_title character varying(255)
);


ALTER TABLE public.organization_leaders OWNER TO hoangviet;

--
-- TOC entry 232 (class 1259 OID 16893)
-- Name: organizations; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.organizations (
    org_id integer NOT NULL,
    org_name character varying(255) NOT NULL,
    parent_id integer,
    display_order integer
);


ALTER TABLE public.organizations OWNER TO hoangviet;

--
-- TOC entry 233 (class 1259 OID 16896)
-- Name: organizations_org_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.organizations_org_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.organizations_org_id_seq OWNER TO hoangviet;

--
-- TOC entry 3689 (class 0 OID 0)
-- Dependencies: 233
-- Name: organizations_org_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.organizations_org_id_seq OWNED BY public.organizations.org_id;


--
-- TOC entry 234 (class 1259 OID 16897)
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    subscription_type character varying(10) NOT NULL,
    subscription_object jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.push_subscriptions OWNER TO hoangviet;

--
-- TOC entry 235 (class 1259 OID 16903)
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.push_subscriptions_id_seq OWNER TO hoangviet;

--
-- TOC entry 3690 (class 0 OID 0)
-- Dependencies: 235
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- TOC entry 236 (class 1259 OID 16904)
-- Name: secretary_scopes; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.secretary_scopes (
    user_id integer NOT NULL,
    org_id integer NOT NULL
);


ALTER TABLE public.secretary_scopes OWNER TO hoangviet;

--
-- TOC entry 237 (class 1259 OID 16907)
-- Name: task_assigned_orgs; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.task_assigned_orgs (
    task_id integer NOT NULL,
    org_id integer NOT NULL
);


ALTER TABLE public.task_assigned_orgs OWNER TO hoangviet;

--
-- TOC entry 238 (class 1259 OID 16910)
-- Name: task_documents; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.task_documents (
    doc_id integer NOT NULL,
    task_id integer NOT NULL,
    doc_name character varying(255) NOT NULL,
    file_path character varying(512)
);


ALTER TABLE public.task_documents OWNER TO hoangviet;

--
-- TOC entry 239 (class 1259 OID 16915)
-- Name: task_documents_doc_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.task_documents_doc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_documents_doc_id_seq OWNER TO hoangviet;

--
-- TOC entry 3691 (class 0 OID 0)
-- Dependencies: 239
-- Name: task_documents_doc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.task_documents_doc_id_seq OWNED BY public.task_documents.doc_id;


--
-- TOC entry 240 (class 1259 OID 16916)
-- Name: task_trackers; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.task_trackers (
    task_id integer NOT NULL,
    user_id integer NOT NULL
);


ALTER TABLE public.task_trackers OWNER TO hoangviet;

--
-- TOC entry 241 (class 1259 OID 16919)
-- Name: tasks; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.tasks (
    task_id integer NOT NULL,
    title text NOT NULL,
    description text,
    creator_id integer,
    status public.task_status DEFAULT 'new'::public.task_status NOT NULL,
    priority public.task_priority DEFAULT 'normal'::public.task_priority NOT NULL,
    document_ref character varying(255),
    is_direct_assignment boolean DEFAULT false,
    due_date timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.tasks OWNER TO hoangviet;

--
-- TOC entry 242 (class 1259 OID 16929)
-- Name: tasks_task_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.tasks_task_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tasks_task_id_seq OWNER TO hoangviet;

--
-- TOC entry 3692 (class 0 OID 0)
-- Dependencies: 242
-- Name: tasks_task_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.tasks_task_id_seq OWNED BY public.tasks.task_id;


--
-- TOC entry 243 (class 1259 OID 16930)
-- Name: user_organizations; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.user_organizations (
    user_id integer NOT NULL,
    org_id integer NOT NULL
);


ALTER TABLE public.user_organizations OWNER TO hoangviet;

--
-- TOC entry 244 (class 1259 OID 16933)
-- Name: users; Type: TABLE; Schema: public; Owner: hoangviet
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    full_name character varying(255) NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    "position" character varying(255),
    role public.user_role NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    push_token character varying(255)
);


ALTER TABLE public.users OWNER TO hoangviet;

--
-- TOC entry 245 (class 1259 OID 16940)
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: hoangviet
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_user_id_seq OWNER TO hoangviet;

--
-- TOC entry 3693 (class 0 OID 0)
-- Dependencies: 245
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hoangviet
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- TOC entry 3358 (class 2604 OID 16941)
-- Name: agendas agenda_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.agendas ALTER COLUMN agenda_id SET DEFAULT nextval('public.agendas_agenda_id_seq'::regclass);


--
-- TOC entry 3359 (class 2604 OID 16942)
-- Name: documents doc_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.documents ALTER COLUMN doc_id SET DEFAULT nextval('public.documents_doc_id_seq'::regclass);


--
-- TOC entry 3360 (class 2604 OID 16943)
-- Name: draft_attachments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_attachments ALTER COLUMN id SET DEFAULT nextval('public.draft_attachments_id_seq'::regclass);


--
-- TOC entry 3362 (class 2604 OID 16944)
-- Name: draft_comments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_comments ALTER COLUMN id SET DEFAULT nextval('public.draft_comments_id_seq'::regclass);


--
-- TOC entry 3364 (class 2604 OID 16945)
-- Name: draft_documents id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_documents ALTER COLUMN id SET DEFAULT nextval('public.draft_documents_id_seq'::regclass);


--
-- TOC entry 3368 (class 2604 OID 16946)
-- Name: draft_participants id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_participants ALTER COLUMN id SET DEFAULT nextval('public.draft_participants_id_seq'::regclass);


--
-- TOC entry 3372 (class 2604 OID 16947)
-- Name: meetings meeting_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meetings ALTER COLUMN meeting_id SET DEFAULT nextval('public.meetings_meeting_id_seq'::regclass);


--
-- TOC entry 3375 (class 2604 OID 16948)
-- Name: organizations org_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organizations ALTER COLUMN org_id SET DEFAULT nextval('public.organizations_org_id_seq'::regclass);


--
-- TOC entry 3376 (class 2604 OID 16949)
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- TOC entry 3378 (class 2604 OID 16950)
-- Name: task_documents doc_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_documents ALTER COLUMN doc_id SET DEFAULT nextval('public.task_documents_doc_id_seq'::regclass);


--
-- TOC entry 3379 (class 2604 OID 16951)
-- Name: tasks task_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.tasks ALTER COLUMN task_id SET DEFAULT nextval('public.tasks_task_id_seq'::regclass);


--
-- TOC entry 3385 (class 2604 OID 16952)
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- TOC entry 3630 (class 0 OID 16837)
-- Dependencies: 216
-- Data for Name: agendas; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.agendas (agenda_id, meeting_id, title, display_order) FROM stdin;
42	114	báo cáo	1
43	114	báo cáo chương trình	2
44	115	Ủng hộ bão	1
\.


--
-- TOC entry 3632 (class 0 OID 16843)
-- Dependencies: 218
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.documents (doc_id, agenda_id, doc_name, file_path) FROM stdin;
25	42	Báo cáo tuần 2-2025.docx	meetings/10-2025/114/Báo cáo tuần 2-2025.docx
26	42	Tiểu ban Nội dung HU.pdf	meetings/10-2025/114/Tiểu ban Nội dung HU.pdf
27	43	basdhbabfsjgb.docx	meetings/10-2025/114/basdhbabfsjgb.docx
28	44	Tin ủng hộ bão bualoi.docx	meetings/10-2025/115/Tin ủng hộ bão bualoi.docx
\.


--
-- TOC entry 3634 (class 0 OID 16849)
-- Dependencies: 220
-- Data for Name: draft_attachments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.draft_attachments (id, draft_id, file_name, file_path, uploaded_at) FROM stdin;
1	2	Quy chế hoạt động BCĐ xóa nhà tạm.docx	drafts/05-10-2025_draft2/Quy chế hoạt động BCĐ xóa nhà tạm.docx	2025-10-05 19:32:57.624748+07
2	3	BC Công tác Văn phòng Huyện ủy Thuận Bắc năm 2024.doc	drafts/05-10-2025_draft3/BC Công tác Văn phòng Huyện ủy Thuận Bắc năm 2024.doc	2025-10-05 19:41:06.37657+07
3	4	BC chính quyền 02 cấp Đảng uỷ Công Hải.docx	drafts/10-2025/4/BC chính quyền 02 cấp Đảng uỷ Công Hải.docx	2025-10-14 16:53:54.661217+07
4	5	BC chính quyền 02 cấp Đảng uỷ Công Hải.docx	drafts/10-2025/5/BC chính quyền 02 cấp Đảng uỷ Công Hải.docx	2025-10-14 17:02:53.654867+07
\.


--
-- TOC entry 3636 (class 0 OID 16856)
-- Dependencies: 222
-- Data for Name: draft_comments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.draft_comments (id, draft_id, user_id, comment, created_at) FROM stdin;
1	1	10	Thay đổi thứ tự các mục trong dự án	2025-10-05 18:35:39.391374+07
2	5	7	123456789	2025-10-14 21:00:11.686955+07
\.


--
-- TOC entry 3638 (class 0 OID 16863)
-- Dependencies: 224
-- Data for Name: draft_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.draft_documents (id, title, document_number, creator_id, status, created_at, updated_at, deadline) FROM stdin;
1	Nghị quyết số 47	123-CV/ĐU	1	qua_han	2025-10-05 17:13:46.987235+07	2025-10-05 17:13:46.987235+07	2025-10-07 08:00:00+07
2	Góp ý dự thảo báo cáo chính trị	123-CV/ĐU	1	qua_han	2025-10-05 19:32:57.624748+07	2025-10-05 19:32:57.624748+07	2025-10-06 19:32:00+07
3	dqwdqwd	qdqwdqwd	1	qua_han	2025-10-05 19:41:06.37657+07	2025-10-05 19:41:06.37657+07	2025-10-06 20:41:00+07
4	123456789		1	qua_han	2025-10-14 16:53:54.661217+07	2025-10-14 16:53:54.661217+07	2025-10-15 16:53:00+07
5	12321323123213213213213213123		10	qua_han	2025-10-14 17:02:53.654867+07	2025-10-14 17:02:53.654867+07	2025-10-16 17:02:00+07
\.


--
-- TOC entry 3640 (class 0 OID 16870)
-- Dependencies: 226
-- Data for Name: draft_participants; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.draft_participants (id, draft_id, user_id, status, response_at, confirmation_hash) FROM stdin;
1	1	8	cho_y_kien	\N	\N
2	1	27	cho_y_kien	\N	\N
3	1	7	cho_y_kien	\N	\N
5	1	23	cho_y_kien	\N	\N
7	1	18	cho_y_kien	\N	\N
8	1	26	cho_y_kien	\N	\N
9	1	24	cho_y_kien	\N	\N
10	1	25	cho_y_kien	\N	\N
11	1	20	cho_y_kien	\N	\N
12	1	19	cho_y_kien	\N	\N
13	1	22	cho_y_kien	\N	\N
14	1	21	cho_y_kien	\N	\N
15	1	13	cho_y_kien	\N	\N
16	1	16	cho_y_kien	\N	\N
17	1	12	cho_y_kien	\N	\N
18	1	11	cho_y_kien	\N	\N
19	1	15	cho_y_kien	\N	\N
20	1	9	cho_y_kien	\N	\N
6	1	10	da_gop_y	2025-10-05 18:35:39.391374+07	\N
4	1	17	da_thong_nhat	2025-10-05 18:36:18.710346+07	40adc82ecf925f20b63dd2ba56eea2305be123093935fc949ec4a230c676db10
22	2	27	cho_y_kien	\N	\N
23	2	7	cho_y_kien	\N	\N
24	2	17	cho_y_kien	\N	\N
25	2	23	cho_y_kien	\N	\N
26	2	10	cho_y_kien	\N	\N
27	2	18	cho_y_kien	\N	\N
28	2	26	cho_y_kien	\N	\N
29	2	24	cho_y_kien	\N	\N
30	2	25	cho_y_kien	\N	\N
31	2	20	cho_y_kien	\N	\N
32	2	19	cho_y_kien	\N	\N
33	2	22	cho_y_kien	\N	\N
34	2	21	cho_y_kien	\N	\N
35	2	13	cho_y_kien	\N	\N
36	2	16	cho_y_kien	\N	\N
37	2	12	cho_y_kien	\N	\N
38	2	11	cho_y_kien	\N	\N
39	2	15	cho_y_kien	\N	\N
40	2	9	cho_y_kien	\N	\N
41	3	8	cho_y_kien	\N	\N
42	3	27	cho_y_kien	\N	\N
43	3	7	cho_y_kien	\N	\N
44	3	17	cho_y_kien	\N	\N
45	3	23	cho_y_kien	\N	\N
46	3	10	cho_y_kien	\N	\N
47	3	18	cho_y_kien	\N	\N
48	3	26	cho_y_kien	\N	\N
49	3	24	cho_y_kien	\N	\N
50	3	25	cho_y_kien	\N	\N
51	3	20	cho_y_kien	\N	\N
52	3	19	cho_y_kien	\N	\N
53	3	22	cho_y_kien	\N	\N
54	3	21	cho_y_kien	\N	\N
55	3	13	cho_y_kien	\N	\N
56	3	16	cho_y_kien	\N	\N
57	3	12	cho_y_kien	\N	\N
58	3	11	cho_y_kien	\N	\N
59	3	15	cho_y_kien	\N	\N
60	3	9	cho_y_kien	\N	\N
21	2	8	da_thong_nhat	2025-10-14 16:46:17.369534+07	85ccd65498d710392998e5bae6ddb1ecf844b9f4c040718e42157915e7329b61
61	4	8	cho_y_kien	\N	\N
62	4	27	cho_y_kien	\N	\N
64	4	17	cho_y_kien	\N	\N
65	4	23	cho_y_kien	\N	\N
66	4	10	cho_y_kien	\N	\N
67	4	18	cho_y_kien	\N	\N
68	4	26	cho_y_kien	\N	\N
69	4	24	cho_y_kien	\N	\N
70	4	25	cho_y_kien	\N	\N
71	4	20	cho_y_kien	\N	\N
72	4	19	cho_y_kien	\N	\N
73	4	22	cho_y_kien	\N	\N
74	4	21	cho_y_kien	\N	\N
75	4	13	cho_y_kien	\N	\N
76	4	16	cho_y_kien	\N	\N
77	4	12	cho_y_kien	\N	\N
78	4	11	cho_y_kien	\N	\N
79	4	15	cho_y_kien	\N	\N
80	4	9	cho_y_kien	\N	\N
63	4	7	da_thong_nhat	2025-10-14 16:56:57.550839+07	c0d7b0871902f6937781d2d075b7c57f15a014838269599f0bcea1c81199994e
81	5	8	cho_y_kien	\N	\N
82	5	27	cho_y_kien	\N	\N
84	5	17	cho_y_kien	\N	\N
85	5	23	cho_y_kien	\N	\N
87	5	18	cho_y_kien	\N	\N
88	5	26	cho_y_kien	\N	\N
89	5	24	cho_y_kien	\N	\N
90	5	25	cho_y_kien	\N	\N
91	5	20	cho_y_kien	\N	\N
92	5	19	cho_y_kien	\N	\N
93	5	22	cho_y_kien	\N	\N
94	5	21	cho_y_kien	\N	\N
95	5	13	cho_y_kien	\N	\N
96	5	16	cho_y_kien	\N	\N
97	5	12	cho_y_kien	\N	\N
98	5	11	cho_y_kien	\N	\N
99	5	15	cho_y_kien	\N	\N
100	5	9	cho_y_kien	\N	\N
83	5	7	da_gop_y	2025-10-14 21:00:11.686955+07	\N
86	5	10	da_thong_nhat	2025-10-14 21:46:48.295794+07	d9113dd1e8febe1b370ea56b1d3d6037bbdbb63d51e7b0cb2d971f14ae4ceb6d
\.


--
-- TOC entry 3642 (class 0 OID 16875)
-- Dependencies: 228
-- Data for Name: meeting_attendees; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.meeting_attendees (meeting_id, user_id, status, check_in_time, qr_code_token, represented_by_user_id, is_delegated) FROM stdin;
114	17	pending	\N	\N	\N	f
114	23	pending	\N	\N	\N	f
114	10	pending	\N	\N	\N	f
114	18	pending	\N	\N	\N	f
114	26	pending	\N	\N	\N	f
114	24	pending	\N	\N	\N	f
114	25	pending	\N	\N	\N	f
114	20	pending	\N	\N	\N	f
114	19	pending	\N	\N	\N	f
114	22	pending	\N	\N	\N	f
114	21	pending	\N	\N	\N	f
114	13	pending	\N	\N	\N	f
114	16	pending	\N	\N	\N	f
114	12	pending	\N	\N	\N	f
114	11	pending	\N	\N	\N	f
114	15	pending	\N	\N	\N	f
114	9	pending	\N	\N	\N	f
114	8	present	2025-10-17 15:43:17.963413+07	\N	\N	f
114	27	present	2025-10-17 16:07:43.222811+07	\N	\N	f
114	7	present	2025-10-17 16:15:09.800869+07	\N	\N	f
115	8	pending	\N	\N	\N	f
115	27	pending	\N	\N	\N	f
115	7	pending	\N	\N	\N	f
115	17	pending	\N	\N	\N	f
115	23	pending	\N	\N	\N	f
115	10	pending	\N	\N	\N	f
115	18	pending	\N	\N	\N	f
115	26	pending	\N	\N	\N	f
115	24	pending	\N	\N	\N	f
115	25	pending	\N	\N	\N	f
115	20	pending	\N	\N	\N	f
115	19	pending	\N	\N	\N	f
115	22	pending	\N	\N	\N	f
115	21	pending	\N	\N	\N	f
115	13	pending	\N	\N	\N	f
115	16	pending	\N	\N	\N	f
115	12	pending	\N	\N	\N	f
115	11	pending	\N	\N	\N	f
115	15	pending	\N	\N	\N	f
115	9	pending	\N	\N	\N	f
\.


--
-- TOC entry 3643 (class 0 OID 16882)
-- Dependencies: 229
-- Data for Name: meetings; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.meetings (meeting_id, title, location, start_time, end_time, creator_id, org_id, created_at, updated_at, chairperson_id, meeting_secretary_id, qr_code_token) FROM stdin;
114	TESTTTTT	Văn phòng Đảng uỷ	2025-10-17 08:00:00+07	2025-10-17 12:00:00+07	1	1	2025-10-16 16:08:51.971964+07	2025-10-16 16:08:51.971964+07	7	10	eaa6c36c1b27c4491193c19deb07aefd
115	tyest k6	dqqwdwqddwqd	2025-10-18 08:00:00+07	2025-10-19 07:00:00+07	1	1	2025-10-18 14:51:47.364335+07	2025-10-18 14:51:47.364335+07	7	1	\N
\.


--
-- TOC entry 3645 (class 0 OID 16890)
-- Dependencies: 231
-- Data for Name: organization_leaders; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.organization_leaders (user_id, org_id, leader_title) FROM stdin;
7	23	Bí thư Đảng uỷ
7	22	Bí thư Đảng uỷ
7	21	Bí thư Đảng uỷ
8	20	Chủ nhiệm UBKT Đảng uỷ
23	20	Phó Chủ nhiệm UBKT Đảng uỷ
17	19	Trưởng Ban Xây dựng Đảng
18	19	Phó Trưởng Ban
8	23	Phó Bí thư Thường trực
10	18	Chánh Văn phòng
\.


--
-- TOC entry 3646 (class 0 OID 16893)
-- Dependencies: 232
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.organizations (org_id, org_name, parent_id, display_order) FROM stdin;
18	Văn phòng Đảng uỷ	1	16
19	Ban Xây dựng Đảng	1	15
20	Uỷ ban kiểm tra Đảng uỷ	1	14
21	Ban Chấp hành Đảng uỷ	1	13
22	Ban Thường vụ Đảng uỷ	1	12
23	Thường trực Đảng uỷ	1	11
24	Thường trực HĐND	4	41
25	Ban Pháp chế HĐND	4	42
26	Ban Ngân sách HĐND	4	43
27	Phòng Kinh tế	5	10
28	Phòng Văn hoá - Xã hội	5	10
29	Trung tâm phục vụ Hành chính công	5	10
30	Văn phòng HĐND - UBND	5	10
31	Lãnh đạo UBND	5	10
5	Uỷ ban nhân dân xã	\N	3
4	Hội đồng nhân dân xã	\N	2
1	Đảng uỷ xã	\N	1
32	Uỷ ban MTTQ Việt Nam xã	\N	4
33	Chi bộ trực thuộc	\N	5
34	Đoàn Thanh niên xã	32	10
\.


--
-- TOC entry 3648 (class 0 OID 16897)
-- Dependencies: 234
-- Data for Name: push_subscriptions; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.push_subscriptions (id, user_id, subscription_type, subscription_object, created_at) FROM stdin;
1	2	expo	{"token": "ExponentPushToken[cnL9NKMJd5aiu43bvKHXwA]"}	2025-09-17 16:32:38.163873+07
2	7	expo	{"token": "ExponentPushToken[YdlfEtHbaGs9wlDPiu4XGf]"}	2025-09-17 16:32:38.163873+07
3	27	expo	{"token": "ExponentPushToken[kER08UPud3dgvxUASzLagV]"}	2025-09-17 16:32:38.163873+07
\.


--
-- TOC entry 3650 (class 0 OID 16904)
-- Dependencies: 236
-- Data for Name: secretary_scopes; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.secretary_scopes (user_id, org_id) FROM stdin;
2	1
\.


--
-- TOC entry 3651 (class 0 OID 16907)
-- Dependencies: 237
-- Data for Name: task_assigned_orgs; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.task_assigned_orgs (task_id, org_id) FROM stdin;
43	19
44	19
45	19
46	32
47	19
48	19
49	34
50	5
51	19
52	5
55	19
55	4
53	4
53	19
53	32
53	20
\.


--
-- TOC entry 3652 (class 0 OID 16910)
-- Dependencies: 238
-- Data for Name: task_documents; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.task_documents (doc_id, task_id, doc_name, file_path) FROM stdin;
11	53	z7121947276162_33a08f74f28ac01cf5e1912fb3b6aed3.jpg	tasks/2025-10/53/1760590340555-970952379-z7121947276162_33a08f74f28ac01cf5e1912fb3b6aed3.jpg
\.


--
-- TOC entry 3654 (class 0 OID 16916)
-- Dependencies: 240
-- Data for Name: task_trackers; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.task_trackers (task_id, user_id) FROM stdin;
43	16
44	16
45	16
46	16
47	16
48	16
49	16
50	15
51	16
52	15
53	15
\.


--
-- TOC entry 3655 (class 0 OID 16919)
-- Dependencies: 241
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.tasks (task_id, title, description, creator_id, status, priority, document_ref, is_direct_assignment, due_date, completed_at, created_at, updated_at) FROM stdin;
44	Kế hoạch tuyên truyền trước, trong và sau Đại hội Mặt trận TQ Việt Nam xã	Giao Ban Xây dựng Đảng tham mưu Ban Thường vụ Đảng uỷ Kế hoạch tuyên truyền trước, trong và sau Đại hội Mặt trận Tổ quốc Việt Nam xã	1	new	normal	15-CV/ĐU	f	2025-09-22 00:00:00+07	\N	2025-09-26 14:48:15.859298+07	2025-09-26 14:48:15.859298+07
45	Lập hồ sơ Đại hội	Lập hồ sơ và nộp lưu hồ sơ về Lưu trữ Văn phòng Đảng uỷ quá trình chuẩn bị báo cáo chính trị, báo cáo kiểm điểm của cấp ủy, dự thảo nghị quyết đại hội và các tài liệu khác trình đại hội; hồ sơ hoạt động của tiểu ban	1	new	normal	17-CV/ĐU	f	2025-09-08 00:00:00+07	\N	2025-09-26 14:56:12.074257+07	2025-09-26 14:56:12.074257+07
46	Triển khai Kế hoạch số 16/KH-MTTQ-UB, ngày 09/9/2025 của của Ủy ban Mặt trận Tổ quốc Việt Nam tỉnh về triển khai nội dung giám sát 6 tháng cuối năm 2025	Ban hành Kế hoạch giám sát 6 tháng cuối năm 2025 theo Kế hoạch số số 16/KH-MTTQ-UB, ngày 09/9/2025 của của Ủy ban Mặt trận Tổ quốc Việt Nam tỉnh về triển khai nội dung giám sát 6 tháng cuối năm 2025	1	new	normal		f	2025-09-30 00:00:00+07	\N	2025-09-26 15:01:46.390563+07	2025-09-26 15:01:46.390563+07
47	Sắp xếp tổ chức bộ máy Hội Chử thập đỏ	Ban Xây dựng Đảng:  phối hợp với Uỷ ban Mặt trận Tổ quốc Việt Nam xã, Uỷ ban nhân dân xã khẩn trương rà soát nhân sự lãnh đạo, Ban Thường vụ, Ban Chấp hành, Ban Kiểm tra Hội Chữ thập đỏ xã cũ; tham mưu Ban Thường vụ Đảng uỷ sắp xếp, bố trí nhân sự làm Chủ tịch Hội Chữ Thập đỏ xã phù hợp với tình hình tại địa phương	1	new	normal	79-CV/ĐU	f	2025-09-22 00:00:00+07	\N	2025-09-26 15:04:11.285055+07	2025-09-26 15:04:11.285055+07
48	Tham mưu văn bản chỉ đạo tổ chức Đại hội Đoàn Thanh niên	Tham mưu Ban Thường vụ Đảng uỷ văn bản chỉ đạo tổ chức Đại hội Đoàn Thanh niên cộng sản Hồ Chí Minh xã Công Hải	1	new	normal	84-CV/ĐU	f	2025-10-22 00:00:00+07	\N	2025-09-26 15:09:28.964997+07	2025-09-26 15:09:28.964997+07
49	Xây dựng Kế hoạch Đại hội Đoàn Thanh niên xã	Phối hợp với Ban Xây dựng Đảng triển khai xây dựng, ban hành Kế hoạch tổ chức Đại hội Đoàn Thanh niên xã và các văn bản phục vụ tổ chức Đại hội	1	new	normal	84-CV/ĐU	f	2025-10-28 00:00:00+07	\N	2025-09-26 15:10:52.944414+07	2025-09-26 15:10:52.944414+07
43	Quían triệt Quy định 337-QĐ/TW về việc gửi, nhận văn bản điện tử trên mạng thông tin diện rộng của Đảng và mạng Internet	Giao Ban Xây dựng Đảng xây dựng, tham mưu Ban Thường vụ Đảng uỷ Kế hoạch tuyên truyền, quán triệt, triển khai thực hiện nghiêm các nội dung tại Quy định số 338-QĐ/TW bằng hình thức phù hợp	1	completed	normal	06/ĐU	f	2025-09-30 00:00:00+07	2025-10-14 16:11:51.192+07	2025-09-26 14:46:34.526894+07	2025-10-14 16:11:51.193608+07
55	Triển khai Kế hoạch số 01-KH/TU ngày 26/9/2025 của BTV TU về lãnh đạo cuộc bầu cử đb Quốc hội khoá XVI và bầu cử đại biểu Hội đồng nhân dân các cấp, NK 2026- 2031	Chủ trì, phối hợp HĐND xã tham mưu Ban Thường vụ Đảng uỷ Kế hoạch quán triệt, tuyên truyền và triển khai thực hiện Kế hoạch số 01-KH/TU ngày 26/9/2025.	15	completed	normal	104-CV/ĐU	f	2025-10-10 00:00:00+07	2025-10-14 16:22:21.373+07	2025-10-14 16:21:12.403889+07	2025-10-14 16:22:21.373743+07
52	Đề xuất nội dung Chương trình công tác toàn khoá của Ban Chấp hành	Đảng uỷ UBND xã chỉ đạo UBND xã chỉ đạo các phòng chuyên môn triển khai thực hiện và tổng hợp chung các nội dung đề xuất của UBND xã vào Chương trình công tác toàn khoá của Ban Chấp hành, Ban thường vụ Đảng uỷ nhiệm kỳ 2025 - 2030	1	completed	normal	31-CV/ĐU	f	2025-08-29 00:00:00+07	2025-10-14 16:23:00.969+07	2025-09-26 16:03:45.638405+07	2025-10-14 16:23:00.969376+07
51	Xây dựng Chương trình hành động thực hiện Nghị quyết Đại hội	Chủ trì phối hợp với các cơ quan liên quan tham mưu Đảng ủy xã Chương trình hành động thực hiện Nghị quyết Đại hội đại biểu Đảng bộ xã lần thứ I, nhiệm kỳ 2025-2030 trên các lĩnh vực xây dựng Đảng, hệ thống chính trị, công tác kiểm tra giám sát, công tác dân vận, hoạt động mặt trận và các tổ chức chính trị-xã hội...	1	completed	normal	31-CV/ĐU	f	2025-08-25 00:00:00+07	2025-10-14 16:28:02.721+07	2025-09-26 15:59:55.576124+07	2025-10-14 16:28:02.722258+07
50	Triển khai Kế hoạch số 294-KH/TU về thực hiện phong trào Bình dân học vụ số	Giao Đảng uỷ UBND xã tham mưu Ban Thường vụ Đảng uỷ Kế hoạch triển khai thực hiện Kế hoạch số 294-KH/TU về thực hiện phong trào Bình dân học vụ số	1	completed	normal		f	2025-08-20 00:00:00+07	2025-10-15 17:04:33.252+07	2025-09-26 15:19:19.871484+07	2025-10-15 17:04:33.253043+07
53	Đề xuất nội dung Chương trình công tác toàn khoá của Ban Chấp hành	Đề xuất nội dung Chương trình công tác toàn khoá của Ban Chấp hành, Ban Thường vụ Đảng uỷ nhiệm kỳ 2025 - 2030	1	new	normal	31-CV/ĐU	f	2025-08-28 00:00:00+07	\N	2025-09-26 16:06:30.906665+07	2025-10-16 11:52:13.452275+07
\.


--
-- TOC entry 3657 (class 0 OID 16930)
-- Dependencies: 243
-- Data for Name: user_organizations; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.user_organizations (user_id, org_id) FROM stdin;
1	1
3	4
3	5
9	18
10	18
10	21
11	18
12	18
13	18
15	18
16	18
17	22
17	21
17	19
18	19
18	21
19	19
20	19
21	19
22	19
8	23
8	20
8	22
8	21
7	23
7	22
7	21
7	24
23	20
23	21
24	20
25	20
26	20
2	1
2	23
2	22
2	21
2	18
27	23
27	22
27	21
27	31
1	21
1	23
1	24
1	25
1	5
1	4
1	22
1	18
\.


--
-- TOC entry 3658 (class 0 OID 16933)
-- Dependencies: 244
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: hoangviet
--

COPY public.users (user_id, full_name, username, email, password_hash, "position", role, created_at, updated_at, push_token) FROM stdin;
3	Văn thư HĐND-UBND	vanthuhdnd	vt.hdndubnd@example.com	$2b$10$ZuVIkOAzT0ZeRM76AuqWc.EOq8eJhnW.U7yJLdSIK5cGiyyi7Ru2S	Văn thư	Secretary	2025-09-03 11:45:25.820073+07	2025-09-08 16:39:52.145087+07	\N
11	Mai Duy Bàng	mdbang	bang@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Phó Chánh Văn phòng Đảng uỷ	Attendee	2025-09-08 17:09:54.436935+07	2025-09-08 17:09:54.436935+07	\N
12	Lê Thị Bích Thuỷ	ltbthuy	thuy@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên VPĐU	Attendee	2025-09-08 17:12:28.240723+07	2025-09-08 17:12:28.240723+07	\N
13	Hồ Thị Thuý Nhi	httnhi	nhi@gmial.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 17:13:01.484242+07	2025-09-08 17:13:01.484242+07	\N
18	Sầm Văn Tim	svtim	tim@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	ĐUV - Phó Trưởng Ban xây dựng Đảng	Attendee	2025-09-08 17:19:06.407882+07	2025-09-08 17:19:06.407882+07	\N
19	Katơr Minh	kminh	minh@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 20:34:03.455887+07	2025-09-08 20:34:03.455887+07	\N
20	Đoàn Quang Vinh	dqvinh	vinh@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 20:34:26.854223+07	2025-09-08 20:34:26.854223+07	\N
21	Trần Thị Bạch Mai	ttbmai	mai@123	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 20:37:46.528993+07	2025-09-08 20:37:46.528993+07	\N
22	Katơr Thị Duyên	ktduyen	kduyen@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 20:38:25.125167+07	2025-09-08 20:38:25.125167+07	\N
24	Phan Thị Ái Hằng	ptahang	hang@gmaic	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 21:21:20.598077+07	2025-09-08 21:21:20.598077+07	\N
25	Trịnh Thị Thuý Lài	tttlai	lai@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 21:21:44.263951+07	2025-09-08 21:21:44.263951+07	\N
26	Chamaléa Xoa	cxoa	xoa@gmial.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 21:22:15.632541+07	2025-09-08 21:22:15.632541+07	\N
9	Ngô Hoàng Việt	hoangviet	hoangviet.vietlong@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Admin	2025-09-08 17:08:31.929505+07	2025-09-08 17:08:31.929505+07	\N
2	Văn thư Đảng uỷ	vanthudanguy	vt.du@example.com	$2b$10$ZuVIkOAzT0ZeRM76AuqWc.EOq8eJhnW.U7yJLdSIK5cGiyyi7Ru2S	Văn thư	Secretary	2025-09-03 11:45:25.820073+07	2025-09-08 22:36:27.174347+07	\N
23	Đường Sĩ Nguyên	dsnguyen	nguyen@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Phó Chủ nhiệm UBKT	Attendee	2025-09-08 21:20:51.182322+07	2025-09-08 21:20:51.182322+07	\N
17	Phạm Cao Thuận	pcthuan	thuan@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	UVTV - Trưởng Ban xây dựng Đảng	Attendee	2025-09-08 17:18:26.460642+07	2025-09-08 17:18:26.460642+07	\N
10	Nguyễn Đăng Quang	ndquang	dangquang@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	ĐUV - Chánh Văn phòng Đảng uỷ	Attendee	2025-09-08 17:09:21.848994+07	2025-09-08 17:09:21.848994+07	ExponentPushToken[YdlfEtHbaGs9wlDPiu4XGf]
15	Mai Thị Thuỷ	mtthuy	thuy1@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 17:13:36.219615+07	2025-09-08 17:13:36.219615+07	\N
16	Katơr Vế	kve	katorve@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Chuyên viên	Attendee	2025-09-08 17:14:11.96631+07	2025-09-08 17:14:11.96631+07	\N
8	Nguyễn Xuân Hoàng 	nxhoang	hoang@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Phó Bí thư Thường trực Đảng uỷ	Attendee	2025-09-08 09:59:43.68645+07	2025-09-08 21:19:43.323794+07	\N
27	Trương Minh Vũ	tmvu	truongminhvu@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Phó Bí thư - Chủ tịch UBND xã	Attendee	2025-09-09 12:20:15.21902+07	2025-09-09 12:23:34.549231+07	\N
7	Vũ Thị Thuỳ Trang	vtttrang	trang@gmail.com	$2a$10$Pv1gbZnQJ3MZnxfRuF3iPObI/UpdQN9/PCux4MXDMUtRk/jQkD5gq	Bí thư Đảng uỷ	Attendee	2025-09-08 09:59:07.766798+07	2025-09-08 21:19:57.602374+07	ExponentPushToken[YqWumYAewRes-KDSS94ZOR]
1	Quản trị viên Hệ thống	admin	admin@example.com	$2b$10$ZuVIkOAzT0ZeRM76AuqWc.EOq8eJhnW.U7yJLdSIK5cGiyyi7Ru2S	Quản trị viên	Admin	2025-09-03 11:45:25.820073+07	2025-09-03 11:45:25.820073+07	\N
\.


--
-- TOC entry 3694 (class 0 OID 0)
-- Dependencies: 217
-- Name: agendas_agenda_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.agendas_agenda_id_seq', 44, true);


--
-- TOC entry 3695 (class 0 OID 0)
-- Dependencies: 219
-- Name: documents_doc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.documents_doc_id_seq', 28, true);


--
-- TOC entry 3696 (class 0 OID 0)
-- Dependencies: 221
-- Name: draft_attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.draft_attachments_id_seq', 4, true);


--
-- TOC entry 3697 (class 0 OID 0)
-- Dependencies: 223
-- Name: draft_comments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.draft_comments_id_seq', 2, true);


--
-- TOC entry 3698 (class 0 OID 0)
-- Dependencies: 225
-- Name: draft_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.draft_documents_id_seq', 5, true);


--
-- TOC entry 3699 (class 0 OID 0)
-- Dependencies: 227
-- Name: draft_participants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.draft_participants_id_seq', 100, true);


--
-- TOC entry 3700 (class 0 OID 0)
-- Dependencies: 230
-- Name: meetings_meeting_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.meetings_meeting_id_seq', 115, true);


--
-- TOC entry 3701 (class 0 OID 0)
-- Dependencies: 233
-- Name: organizations_org_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.organizations_org_id_seq', 34, true);


--
-- TOC entry 3702 (class 0 OID 0)
-- Dependencies: 235
-- Name: push_subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.push_subscriptions_id_seq', 3, true);


--
-- TOC entry 3703 (class 0 OID 0)
-- Dependencies: 239
-- Name: task_documents_doc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.task_documents_doc_id_seq', 12, true);


--
-- TOC entry 3704 (class 0 OID 0)
-- Dependencies: 242
-- Name: tasks_task_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.tasks_task_id_seq', 73, true);


--
-- TOC entry 3705 (class 0 OID 0)
-- Dependencies: 245
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: hoangviet
--

SELECT pg_catalog.setval('public.users_user_id_seq', 28, true);


--
-- TOC entry 3389 (class 2606 OID 16954)
-- Name: agendas agendas_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.agendas
    ADD CONSTRAINT agendas_pkey PRIMARY KEY (agenda_id);


--
-- TOC entry 3392 (class 2606 OID 16956)
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (doc_id);


--
-- TOC entry 3395 (class 2606 OID 16958)
-- Name: draft_attachments draft_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_attachments
    ADD CONSTRAINT draft_attachments_pkey PRIMARY KEY (id);


--
-- TOC entry 3397 (class 2606 OID 16960)
-- Name: draft_comments draft_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_comments
    ADD CONSTRAINT draft_comments_pkey PRIMARY KEY (id);


--
-- TOC entry 3399 (class 2606 OID 16962)
-- Name: draft_documents draft_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_documents
    ADD CONSTRAINT draft_documents_pkey PRIMARY KEY (id);


--
-- TOC entry 3401 (class 2606 OID 16964)
-- Name: draft_participants draft_participants_draft_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_participants
    ADD CONSTRAINT draft_participants_draft_id_user_id_key UNIQUE (draft_id, user_id);


--
-- TOC entry 3403 (class 2606 OID 16966)
-- Name: draft_participants draft_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_participants
    ADD CONSTRAINT draft_participants_pkey PRIMARY KEY (id);


--
-- TOC entry 3407 (class 2606 OID 16968)
-- Name: meeting_attendees meeting_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_pkey PRIMARY KEY (meeting_id, user_id);


--
-- TOC entry 3409 (class 2606 OID 16970)
-- Name: meeting_attendees meeting_attendees_qr_code_token_key; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_qr_code_token_key UNIQUE (qr_code_token);


--
-- TOC entry 3416 (class 2606 OID 16972)
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (meeting_id);


--
-- TOC entry 3419 (class 2606 OID 16974)
-- Name: organization_leaders organization_leaders_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organization_leaders
    ADD CONSTRAINT organization_leaders_pkey PRIMARY KEY (user_id, org_id);


--
-- TOC entry 3421 (class 2606 OID 16976)
-- Name: organizations organizations_org_name_key; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_org_name_key UNIQUE (org_name);


--
-- TOC entry 3423 (class 2606 OID 16978)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (org_id);


--
-- TOC entry 3426 (class 2606 OID 16980)
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- TOC entry 3431 (class 2606 OID 16982)
-- Name: secretary_scopes secretary_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.secretary_scopes
    ADD CONSTRAINT secretary_scopes_pkey PRIMARY KEY (user_id, org_id);


--
-- TOC entry 3435 (class 2606 OID 16984)
-- Name: task_assigned_orgs task_assigned_orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_assigned_orgs
    ADD CONSTRAINT task_assigned_orgs_pkey PRIMARY KEY (task_id, org_id);


--
-- TOC entry 3437 (class 2606 OID 16986)
-- Name: task_documents task_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_documents
    ADD CONSTRAINT task_documents_pkey PRIMARY KEY (doc_id);


--
-- TOC entry 3441 (class 2606 OID 16988)
-- Name: task_trackers task_trackers_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_trackers
    ADD CONSTRAINT task_trackers_pkey PRIMARY KEY (task_id, user_id);


--
-- TOC entry 3446 (class 2606 OID 16990)
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (task_id);


--
-- TOC entry 3428 (class 2606 OID 16992)
-- Name: push_subscriptions unique_user_subscription; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT unique_user_subscription UNIQUE (user_id, subscription_object);


--
-- TOC entry 3450 (class 2606 OID 16994)
-- Name: user_organizations user_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_pkey PRIMARY KEY (user_id, org_id);


--
-- TOC entry 3453 (class 2606 OID 16996)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 3455 (class 2606 OID 16998)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- TOC entry 3457 (class 2606 OID 17000)
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- TOC entry 3390 (class 1259 OID 17001)
-- Name: idx_agendas_meeting_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_agendas_meeting_id ON public.agendas USING btree (meeting_id);


--
-- TOC entry 3393 (class 1259 OID 17002)
-- Name: idx_documents_agenda_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_documents_agenda_id ON public.documents USING btree (agenda_id);


--
-- TOC entry 3404 (class 1259 OID 17003)
-- Name: idx_meeting_attendees_meeting_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meeting_attendees_meeting_id ON public.meeting_attendees USING btree (meeting_id);


--
-- TOC entry 3405 (class 1259 OID 17004)
-- Name: idx_meeting_attendees_user_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meeting_attendees_user_id ON public.meeting_attendees USING btree (user_id);


--
-- TOC entry 3410 (class 1259 OID 17005)
-- Name: idx_meetings_chairperson_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meetings_chairperson_id ON public.meetings USING btree (chairperson_id);


--
-- TOC entry 3411 (class 1259 OID 17006)
-- Name: idx_meetings_creator_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meetings_creator_id ON public.meetings USING btree (creator_id);


--
-- TOC entry 3412 (class 1259 OID 17007)
-- Name: idx_meetings_meeting_secretary_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meetings_meeting_secretary_id ON public.meetings USING btree (meeting_secretary_id);


--
-- TOC entry 3413 (class 1259 OID 17008)
-- Name: idx_meetings_org_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meetings_org_id ON public.meetings USING btree (org_id);


--
-- TOC entry 3414 (class 1259 OID 17009)
-- Name: idx_meetings_start_time; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_meetings_start_time ON public.meetings USING btree (start_time DESC);


--
-- TOC entry 3417 (class 1259 OID 17010)
-- Name: idx_organization_leaders_org_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_organization_leaders_org_id ON public.organization_leaders USING btree (org_id);


--
-- TOC entry 3424 (class 1259 OID 17011)
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);


--
-- TOC entry 3429 (class 1259 OID 17012)
-- Name: idx_secretary_scopes_user_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_secretary_scopes_user_id ON public.secretary_scopes USING btree (user_id);


--
-- TOC entry 3432 (class 1259 OID 17013)
-- Name: idx_task_assigned_orgs_org_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_task_assigned_orgs_org_id ON public.task_assigned_orgs USING btree (org_id);


--
-- TOC entry 3433 (class 1259 OID 17014)
-- Name: idx_task_assigned_orgs_task_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_task_assigned_orgs_task_id ON public.task_assigned_orgs USING btree (task_id);


--
-- TOC entry 3438 (class 1259 OID 17015)
-- Name: idx_task_trackers_task_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_task_trackers_task_id ON public.task_trackers USING btree (task_id);


--
-- TOC entry 3439 (class 1259 OID 17016)
-- Name: idx_task_trackers_user_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_task_trackers_user_id ON public.task_trackers USING btree (user_id);


--
-- TOC entry 3442 (class 1259 OID 17017)
-- Name: idx_tasks_creator_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_tasks_creator_id ON public.tasks USING btree (creator_id);


--
-- TOC entry 3443 (class 1259 OID 17018)
-- Name: idx_tasks_due_date_created_at; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_tasks_due_date_created_at ON public.tasks USING btree (due_date, created_at DESC);


--
-- TOC entry 3444 (class 1259 OID 17019)
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- TOC entry 3447 (class 1259 OID 17020)
-- Name: idx_user_organizations_org_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_user_organizations_org_id ON public.user_organizations USING btree (org_id);


--
-- TOC entry 3448 (class 1259 OID 17021)
-- Name: idx_user_organizations_user_id; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_user_organizations_user_id ON public.user_organizations USING btree (user_id);


--
-- TOC entry 3451 (class 1259 OID 17022)
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: hoangviet
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- TOC entry 3458 (class 2606 OID 17023)
-- Name: agendas agendas_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.agendas
    ADD CONSTRAINT agendas_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(meeting_id) ON DELETE CASCADE;


--
-- TOC entry 3459 (class 2606 OID 17028)
-- Name: documents documents_agenda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_agenda_id_fkey FOREIGN KEY (agenda_id) REFERENCES public.agendas(agenda_id) ON DELETE CASCADE;


--
-- TOC entry 3460 (class 2606 OID 17033)
-- Name: draft_attachments draft_attachments_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_attachments
    ADD CONSTRAINT draft_attachments_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.draft_documents(id) ON DELETE CASCADE;


--
-- TOC entry 3463 (class 2606 OID 17038)
-- Name: draft_documents fk_creator; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_documents
    ADD CONSTRAINT fk_creator FOREIGN KEY (creator_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 3464 (class 2606 OID 17043)
-- Name: draft_participants fk_draft; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_participants
    ADD CONSTRAINT fk_draft FOREIGN KEY (draft_id) REFERENCES public.draft_documents(id) ON DELETE CASCADE;


--
-- TOC entry 3461 (class 2606 OID 17048)
-- Name: draft_comments fk_draft_comment; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_comments
    ADD CONSTRAINT fk_draft_comment FOREIGN KEY (draft_id) REFERENCES public.draft_documents(id) ON DELETE CASCADE;


--
-- TOC entry 3465 (class 2606 OID 17053)
-- Name: draft_participants fk_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_participants
    ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3462 (class 2606 OID 17058)
-- Name: draft_comments fk_user_comment; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.draft_comments
    ADD CONSTRAINT fk_user_comment FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3466 (class 2606 OID 17063)
-- Name: meeting_attendees meeting_attendees_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(meeting_id) ON DELETE CASCADE;


--
-- TOC entry 3467 (class 2606 OID 17068)
-- Name: meeting_attendees meeting_attendees_represented_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_represented_by_user_id_fkey FOREIGN KEY (represented_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 3468 (class 2606 OID 17073)
-- Name: meeting_attendees meeting_attendees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3469 (class 2606 OID 17078)
-- Name: meetings meetings_chairperson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_chairperson_id_fkey FOREIGN KEY (chairperson_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 3470 (class 2606 OID 17083)
-- Name: meetings meetings_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 3471 (class 2606 OID 17088)
-- Name: meetings meetings_meeting_secretary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_meeting_secretary_id_fkey FOREIGN KEY (meeting_secretary_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 3472 (class 2606 OID 17093)
-- Name: meetings meetings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE;


--
-- TOC entry 3473 (class 2606 OID 17098)
-- Name: organization_leaders organization_leaders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organization_leaders
    ADD CONSTRAINT organization_leaders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE;


--
-- TOC entry 3474 (class 2606 OID 17103)
-- Name: organization_leaders organization_leaders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organization_leaders
    ADD CONSTRAINT organization_leaders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3475 (class 2606 OID 17108)
-- Name: organizations organizations_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.organizations(org_id) ON DELETE SET NULL;


--
-- TOC entry 3476 (class 2606 OID 17113)
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3477 (class 2606 OID 17118)
-- Name: secretary_scopes secretary_scopes_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.secretary_scopes
    ADD CONSTRAINT secretary_scopes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE;


--
-- TOC entry 3478 (class 2606 OID 17123)
-- Name: secretary_scopes secretary_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.secretary_scopes
    ADD CONSTRAINT secretary_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3479 (class 2606 OID 17128)
-- Name: task_assigned_orgs task_assigned_orgs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_assigned_orgs
    ADD CONSTRAINT task_assigned_orgs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE;


--
-- TOC entry 3480 (class 2606 OID 17133)
-- Name: task_assigned_orgs task_assigned_orgs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_assigned_orgs
    ADD CONSTRAINT task_assigned_orgs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- TOC entry 3481 (class 2606 OID 17138)
-- Name: task_documents task_documents_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_documents
    ADD CONSTRAINT task_documents_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- TOC entry 3482 (class 2606 OID 17143)
-- Name: task_trackers task_trackers_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_trackers
    ADD CONSTRAINT task_trackers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- TOC entry 3483 (class 2606 OID 17148)
-- Name: task_trackers task_trackers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.task_trackers
    ADD CONSTRAINT task_trackers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3484 (class 2606 OID 17153)
-- Name: tasks tasks_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 3485 (class 2606 OID 17158)
-- Name: user_organizations user_organizations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE;


--
-- TOC entry 3486 (class 2606 OID 17163)
-- Name: user_organizations user_organizations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hoangviet
--

ALTER TABLE ONLY public.user_organizations
    ADD CONSTRAINT user_organizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 3665 (class 0 OID 0)
-- Dependencies: 6
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO hoangviet;


--
-- TOC entry 3669 (class 0 OID 0)
-- Dependencies: 220
-- Name: TABLE draft_attachments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.draft_attachments TO hoangviet;


--
-- TOC entry 3671 (class 0 OID 0)
-- Dependencies: 221
-- Name: SEQUENCE draft_attachments_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.draft_attachments_id_seq TO hoangviet;


--
-- TOC entry 3673 (class 0 OID 0)
-- Dependencies: 222
-- Name: TABLE draft_comments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.draft_comments TO hoangviet;


--
-- TOC entry 3675 (class 0 OID 0)
-- Dependencies: 223
-- Name: SEQUENCE draft_comments_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.draft_comments_id_seq TO hoangviet;


--
-- TOC entry 3679 (class 0 OID 0)
-- Dependencies: 224
-- Name: TABLE draft_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.draft_documents TO hoangviet;


--
-- TOC entry 3681 (class 0 OID 0)
-- Dependencies: 225
-- Name: SEQUENCE draft_documents_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.draft_documents_id_seq TO hoangviet;


--
-- TOC entry 3684 (class 0 OID 0)
-- Dependencies: 226
-- Name: TABLE draft_participants; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.draft_participants TO hoangviet;


--
-- TOC entry 3686 (class 0 OID 0)
-- Dependencies: 227
-- Name: SEQUENCE draft_participants_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.draft_participants_id_seq TO hoangviet;


--
-- TOC entry 2145 (class 826 OID 17168)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO hoangviet;


--
-- TOC entry 2146 (class 826 OID 17169)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO hoangviet;


-- Completed on 2025-10-18 23:04:51

--
-- PostgreSQL database dump complete
--

\unrestrict eaA3ETT3u52SBPWGvsyKfcqROAGXEhbnzU2NJeeXqaB7u5B1ayMV4t69Cy7KRT8


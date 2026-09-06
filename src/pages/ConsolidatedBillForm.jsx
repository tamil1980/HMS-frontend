import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Form, Input, Select, Button, DatePicker, message, Typography, Row, Col, Divider, InputNumber, Space, Table, Tabs, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { patientAPI, masterAPI, labAPI, ipAPI, pharmacyAPI, radiologyAPI, consolidatedBillAPI } from '../services/api';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Option } = Select;

const gstRates = [0, 2, 5, 12, 18];
const paymentModes = ['Cash', 'UPI', 'Debit Card', 'Credit Card'];

const SECTION_META = [
  { type: 'OP', label: 'OP (Consultation / Services)', color: 'blue', catalogKey: 'masters', placeholder: 'Select service', refKey: 'master' },
  { type: 'Lab', label: 'Laboratory Tests', color: 'cyan', catalogKey: 'labTests', placeholder: 'Select lab test', refKey: 'test' },
  { type: 'IP', label: 'IP (Room / Doctor / Nursing / Procedure)', color: 'red', catalogKey: 'components', placeholder: 'Select IP component', refKey: 'component' },
  { type: 'Pharmacy', label: 'Pharmacy (Medicines)', color: 'orange', catalogKey: 'medicines', placeholder: 'Select medicine', refKey: 'medicine' },
  { type: 'Radiology', label: 'Radiology (X-Ray / CT / MRI / USG)', color: 'purple', catalogKey: 'radiologyTests', placeholder: 'Select x-ray / scan', refKey: 'radTest' },
];

const emptySection = () => ({ items: [], discount: 0, discountType: 'fixed', gstRate: 0 });

const rateOf = (meta, cat) => {
  if (meta.catalogKey === 'components') return cat.rate || 0;
  if (meta.catalogKey === 'medicines') return cat.salePrice || 0;
  return cat.price || 0;
};

export default function ConsolidatedBillForm() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [masters, setMasters] = useState([]);
  const [labTests, setLabTests] = useState([]);
  const [components, setComponents] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [radiologyTests, setRadiologyTests] = useState([]);
  const [sections, setSections] = useState(SECTION_META.map(m => ({ ...emptySection(), type: m.type })));
  const [paymentMode, setPaymentMode] = useState('Cash');
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  const qAdmission = params.get('admission');

  const catalogs = { masters, labTests, components, medicines, radiologyTests };

  useEffect(() => {
    patientAPI.getAll({ limit: 50 }).then(res => setPatients(res.data.patients));
    ipAPI.getAdmissions({ status: 'Admitted', limit: 100 }).then(res => setAdmissions(res.data.admissions)).catch(() => {});
    masterAPI.getAll({ type: 'Service', active: 'true' }).then(res => setMasters(res.data)).catch(() => {});
    labAPI.getTests({ active: 'true' }).then(res => setLabTests(res.data)).catch(() => {});
    ipAPI.getComponents({ active: 'true' }).then(res => setComponents(res.data)).catch(() => {});
    pharmacyAPI.getMedicines({ active: 'true' }).then(res => setMedicines(res.data)).catch(() => {});
    radiologyAPI.getTests().then(res => setRadiologyTests(res.data)).catch(() => {});

    if (!isEdit && qAdmission) {
      ipAPI.getAdmissionById(qAdmission).then(res => {
        const d = res.data;
        form.setFieldValue('admission', d._id);
        if (d.patient?._id) form.setFieldValue('patient', d.patient._id);
      }).catch(() => {});
    }

    if (isEdit) {
      consolidatedBillAPI.getBillById(id).then(res => {
        const d = res.data;
        form.setFieldsValue({
          patient: d.patient?._id,
          admission: d.admission?._id,
          billDate: d.billDate ? dayjs(d.billDate) : dayjs(),
          status: d.status,
          notes: d.notes,
          amountPaid: d.amountPaid,
        });
        const saved = (d.sections || []).map(sec => ({
          type: sec.type,
          items: (sec.items || []).map(it => ({ ...it, key: Date.now() + Math.random() })),
          discount: sec.discount || 0,
          discountType: sec.discountType || 'fixed',
          gstRate: sec.gstRate || 0,
        }));
        const merged = SECTION_META.map(m => saved.find(s => s.type === m.type) || { ...emptySection(), type: m.type });
        setSections(merged);
        const pay = d.payments?.[0];
        if (pay) {
          setPaymentMode(pay.mode);
          form.setFieldsValue({
            paymentMode: pay.mode,
            transactionId: pay.transactionId,
            cardNumber: pay.cardNumber,
            cardHolder: pay.cardHolder,
            cardExpiry: pay.cardExpiry,
          });
        }
      }).catch(() => message.error('Failed to load'));
    }
  }, [id]);

  const sectionOf = (type) => sections.find(s => s.type === type);

  const updateSection = (type, patch) => {
    setSections(prev => prev.map(s => (s.type === type ? { ...s, ...patch } : s)));
  };

  const sectionTotals = (sec) => {
    const subtotal = sec.items.reduce((sum, it) => sum + (it.amount || 0), 0);
    const discountAmount = sec.discountType === 'percentage' ? subtotal * (sec.discount / 100) : Number(sec.discount);
    const taxable = Math.max(0, subtotal - discountAmount);
    const cgst = taxable * (sec.gstRate / 2) / 100;
    const sgst = taxable * (sec.gstRate / 2) / 100;
    const tax = cgst + sgst;
    return { subtotal, discount: discountAmount, taxable, cgst, sgst, tax, grandTotal: taxable + tax };
  };

  const billTotals = () => {
    const ts = sections.map(sectionTotals);
    return {
      subtotal: ts.reduce((s, t) => s + t.subtotal, 0),
      discount: ts.reduce((s, t) => s + t.discount, 0),
      tax: ts.reduce((s, t) => s + t.tax, 0),
      grandTotal: ts.reduce((s, t) => s + t.grandTotal, 0),
    };
  };

  const handleCatalogSelect = (type, index, catId) => {
    const meta = SECTION_META.find(m => m.type === type);
    const cat = catalogs[meta.catalogKey].find(c => c._id === catId);
    if (!cat) return;
    const sec = sectionOf(type);
    const newItems = [...sec.items];
    newItems[index] = {
      ...newItems[index],
      [meta.refKey]: cat._id,
      name: cat.name,
      category: cat.category || undefined,
      price: rateOf(meta, cat),
      gstRate: cat.gstRate || 0,
      quantity: 1,
      amount: 1 * (rateOf(meta, cat) || 0),
      key: newItems[index].key || Date.now(),
    };
    updateSection(type, { items: newItems });
  };

  const updateItem = (type, index, field, value) => {
    const sec = sectionOf(type);
    const newItems = [...sec.items];
    newItems[index][field] = value;
    if (field === 'quantity' || field === 'price') {
      newItems[index].amount = (newItems[index].quantity || 0) * (newItems[index].price || 0);
    }
    updateSection(type, { items: newItems });
  };

  const removeItem = (type, index) => {
    const sec = sectionOf(type);
    updateSection(type, { items: sec.items.filter((_, i) => i !== index) });
  };

  const addItem = (type) => {
    const sec = sectionOf(type);
    updateSection(type, { items: [...sec.items, { name: '', quantity: 1, price: 0, gstRate: 0, amount: 0, key: Date.now() }] });
  };

  const totals = billTotals();

  const onFinish = async (values) => {
    if (!sections.some(s => s.items.length)) {
      message.warning('Add at least one item in a section');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...values,
        billDate: values.billDate?.toISOString(),
        sections: sections.map(s => ({
          type: s.type,
          items: s.items.map(({ key, ...it }) => it),
          discount: s.discount,
          discountType: s.discountType,
          gstRate: s.gstRate,
        })),
        paymentMode,
        amountDue: totals.grandTotal - (values.amountPaid || 0),
      };
      if (isEdit) { await consolidatedBillAPI.updateBill(id, payload); message.success('Updated'); }
      else { await consolidatedBillAPI.createBill(payload); message.success('Consolidated bill created'); }
      navigate('/consolidated-bills');
    } catch (err) { message.error(err.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  const renderItemTable = (sec) => {
    const meta = SECTION_META.find(m => m.type === sec.type);
    const catalog = catalogs[meta.catalogKey];
    const columns = [
      { title: <div style={{ textAlign: 'center' }}>S.No</div>, key: 'idx', width: 45, align: 'center', render: (_, __, i) => i + 1 },
      {
        title: meta.type === 'Pharmacy' ? 'Medicine' : 'Item', key: 'name',
        render: (_, __, i) => (
          <Select
            value={sec.items[i][meta.refKey] || undefined}
            onChange={(v) => handleCatalogSelect(sec.type, i, v)}
            showSearch
            placeholder={meta.placeholder}
            allowClear
            style={{ width: '100%' }}
            filterOption={(input, option) => option.children.toLowerCase().includes(input.toLowerCase())}
          >
            {catalog.map(c => (
              <Option key={c._id} value={c._id}>
                {c.name}{c.category ? ` (${c.category})` : ''} - ₹{rateOf(meta, c)}
                {meta.catalogKey === 'medicines' ? ` (Stock: ${c.quantity || 0})` : ''}
              </Option>
            ))}
          </Select>
        ),
      },
      { title: 'Qty', key: 'qty', width: 70, render: (_, __, i) => <InputNumber min={1} value={sec.items[i].quantity} onChange={v => updateItem(sec.type, i, 'quantity', v)} style={{ width: 55 }} /> },
      { title: 'Rate (₹)', key: 'rate', width: 100, render: (_, __, i) => <InputNumber min={0} value={sec.items[i].price} onChange={v => updateItem(sec.type, i, 'price', v)} style={{ width: 85 }} /> },
      { title: 'GST', key: 'gst', width: 60, render: (_, __, i) => (sec.items[i].gstRate ? `${sec.items[i].gstRate}%` : '-') },
      { title: 'Amount', key: 'amt', width: 90, render: (_, __, i) => <strong>₹{(sec.items[i].amount || 0).toFixed(2)}</strong> },
      { title: '', key: 'del', width: 35, render: (_, __, i) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeItem(sec.type, i)} /> },
    ];
    const st = sectionTotals(sec);
    return (
      <div>
        <Table dataSource={sec.items} columns={columns} rowKey="key" pagination={false} size="small" bordered scroll={{ x: 750 }} />
        <Button type="dashed" onClick={() => addItem(sec.type)} icon={<PlusOutlined />} block style={{ marginTop: 8 }}>Add Item</Button>
        <Card size="small" style={{ background: '#f9fafb', marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Space size={4}>
              <span>Section Discount:</span>
              <InputNumber min={0} value={sec.discount} onChange={v => updateSection(sec.type, { discount: v || 0 })} style={{ width: 70 }} size="small" />
              <Select value={sec.discountType} onChange={v => updateSection(sec.type, { discountType: v })} style={{ width: 90 }} size="small"
                options={[{ value: 'fixed', label: 'Fixed' }, { value: 'percentage', label: '%' }]} />
            </Space>
            <strong style={{ color: '#dc2626' }}>-₹{st.discount.toFixed(2)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Space size={4}>
              <span>Section GST:</span>
              <Select value={sec.gstRate} onChange={v => updateSection(sec.type, { gstRate: v || 0 })} style={{ width: 80 }} size="small"
                options={gstRates.map(g => ({ value: g, label: `${g}%` }))} />
            </Space>
            <span style={{ fontSize: 12 }}>CGST ₹{st.cgst.toFixed(2)} + SGST ₹{st.sgst.toFixed(2)}</span>
          </div>
          <Divider style={{ margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2563EB', fontWeight: 600 }}>
            <span>{meta.type} Section Subtotal:</span><span>₹{st.subtotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2563EB', fontWeight: 700, fontSize: 15 }}>
            <span>{meta.type} Section Total:</span><span>₹{st.grandTotal.toFixed(2)}</span>
          </div>
        </Card>
      </div>
    );
  };

  const tabItems = SECTION_META.map(meta => {
    const sec = sectionOf(meta.type);
    const st = sectionTotals(sec);
    return {
      key: meta.type,
      label: <span>{meta.type} <Tag color={meta.color} style={{ marginLeft: 4 }}>₹{st.grandTotal.toFixed(0)}</Tag></span>,
      children: renderItemTable(sec),
    };
  });

  return (
    <Card style={{ borderRadius: 10, maxWidth: 1200, margin: '0 auto' }}>
      <Title level={4}>{isEdit ? 'Edit Consolidated Bill' : 'New Consolidated Bill'}</Title>
      <Typography.Paragraph type="secondary">Combine OP, Lab, IP, Pharmacy and / or Radiology items into one single bill.</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={onFinish}
        initialValues={{ billDate: dayjs(), status: 'Unpaid', amountPaid: 0, paymentMode: 'Cash' }}>
        <Row gutter={16}>
          <Col xs={24} md={10}>
            <Form.Item name="patient" label="Patient" rules={[{ required: true, message: 'Select a patient' }]}>
              <Select showSearch placeholder="Search patient..."
                filterOption={(input, option) => option.children.toLowerCase().includes(input.toLowerCase())}>
                {patients.map(p => <Option key={p._id} value={p._id}>{p.name} - {p.patientId}</Option>)}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="admission" label="Admission (optional, for IP)">
              <Select showSearch allowClear placeholder="Select admission..."
                filterOption={(input, option) => option.children.toLowerCase().includes(input.toLowerCase())}>
                {admissions.map(a => <Option key={a._id} value={a._id}>{a.admissionId} - {a.patient?.name} ({a.roomType || 'General'})</Option>)}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={12} md={3}>
            <Form.Item name="billDate" label="Date"><DatePicker style={{ width: '100%' }} /></Form.Item>
          </Col>
          <Col xs={12} md={3}>
            <Form.Item name="status" label="Status">
              <Select options={['Paid', 'Partial', 'Unpaid'].map(s => ({ value: s, label: s }))} />
            </Form.Item>
          </Col>
        </Row>

        <Tabs items={tabItems} />

        <Divider />
        <Row gutter={16}>
          <Col xs={24} md={14}>
            <Form.Item name="notes" label="Notes"><Input.TextArea rows={4} /></Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Card size="small" style={{ background: '#f9fafb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Bill Subtotal:</span><strong>₹{totals.subtotal.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Bill Discount (sum of sections):</span><strong style={{ color: '#dc2626' }}>-₹{totals.discount.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Bill GST (CGST + SGST):</span><strong>+₹{totals.tax.toFixed(2)}</strong>
              </div>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, color: '#2563EB' }}>
                <strong>Grand Total:</strong><strong>₹{totals.grandTotal.toFixed(2)}</strong>
              </div>
            </Card>
            <div style={{ marginTop: 8 }}>
              <Form.Item name="amountPaid" label="Amount Paid" style={{ marginBottom: 0 }}>
                <InputNumber min={0} prefix="₹" style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div style={{ marginTop: 12 }}>
              <Form.Item name="paymentMode" label="Payment Mode" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <Select value={paymentMode} onChange={setPaymentMode}
                  options={paymentModes.map(m => ({ value: m, label: m }))} />
              </Form.Item>
            </div>
            {(paymentMode === 'UPI') && (
              <div style={{ marginTop: 12 }}>
                <Form.Item name="transactionId" label="Transaction ID" rules={[{ required: true, message: 'Enter UPI transaction ID' }]} style={{ marginBottom: 0 }}>
                  <Input placeholder="e.g. 425178963214" />
                </Form.Item>
              </div>
            )}
            {(paymentMode === 'Debit Card' || paymentMode === 'Credit Card') && (
              <div style={{ marginTop: 12 }}>
                <Row gutter={8}>
                  <Col span={24}>
                    <Form.Item name="cardNumber" label="Card Number" rules={[{ required: true, message: 'Enter card number' }, { len: 16, message: '16 digits required' }]} style={{ marginBottom: 8 }}>
                      <Input maxLength={16} placeholder="Enter 16 digit card number" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="cardHolder" label="Card Holder" rules={[{ required: true, message: 'Card holder name' }]} style={{ marginBottom: 8 }}>
                      <Input placeholder="Name on card" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="cardExpiry" label="Expiry (MM/YY)" rules={[{ required: true, message: 'Expiry' }]} style={{ marginBottom: 8 }}>
                      <Input maxLength={5} placeholder="MM/YY" />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            )}
          </Col>
        </Row>

        <Divider />
        <Space>
          <Button type="primary" htmlType="submit" loading={loading} size="large">{isEdit ? 'Update Bill' : 'Create Bill'}</Button>
          <Button onClick={() => navigate('/consolidated-bills')} size="large">Cancel</Button>
        </Space>
      </Form>
    </Card>
  );
}
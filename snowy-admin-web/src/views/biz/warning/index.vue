<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="学号 / 姓名 / 触发摘要" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="level" label="等级">
						<a-select v-model:value="searchFormState.level" placeholder="全部" allow-clear>
							<a-select-option value="yellow">黄色</a-select-option>
							<a-select-option value="orange">橙色</a-select-option>
							<a-select-option value="red">红色</a-select-option>
							<a-select-option value="severe">严重</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="status" label="状态">
						<a-select v-model:value="searchFormState.status" placeholder="全部" allow-clear>
							<a-select-option value="open">待确认</a-select-option>
							<a-select-option value="acknowledged">已确认</a-select-option>
							<a-select-option value="closed">已关闭</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="windowType" label="窗口">
						<a-select v-model:value="searchFormState.windowType" placeholder="全部" allow-clear>
							<a-select-option value="day">日</a-select-option>
							<a-select-option value="week">周</a-select-option>
							<a-select-option value="month">月</a-select-option>
							<a-select-option value="term">学期</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item>
						<a-space>
							<a-button type="primary" @click="tableRef.refresh(true)">
								<template #icon><SearchOutlined /></template>
								查询
							</a-button>
							<a-button @click="reset">
								<template #icon><redo-outlined /></template>
								重置
							</a-button>
						</a-space>
					</a-form-item>
				</a-col>
			</a-row>
		</a-form>
		<s-table
			ref="tableRef"
			:columns="columns"
			:data="loadData"
			:alert="false"
			bordered
			:tool-config="{ refresh: true, height: true, columnSetting: true }"
			:row-key="(record) => record.id"
			:row-selection="options.rowSelection"
			:scroll="{ x: 'max-content' }"
		>
			<template #operator>
				<a-space>
					<a-popconfirm title="确定按最新规则、排除日与请假豁免全量重算预警？" @confirm="runRescan">
						<a-button type="primary" :loading="scanning" v-if="hasPerm('bizWarningRescan')">
							<template #icon><ThunderboltOutlined /></template>
							全量扫描重算
						</a-button>
					</a-popconfirm>
					<xn-batch-button
						v-if="hasPerm('bizWarningDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'metric'">
					{{ metricLabel(record.metric) }}
				</template>
				<template v-if="column.dataIndex === 'windowType'">
					{{ windowLabel(record.windowType) }}
				</template>
				<template v-if="column.dataIndex === 'triggerSummary'">
					{{ formatSummary(record.triggerSummary) }}
				</template>
				<template v-if="column.dataIndex === 'level'">
					<a-tag :color="levelColor(record.level)">{{ levelLabel(record.level) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'status'">
					<a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a @click="openDetail(record)">详情</a>
					<template v-if="record.status === 'open' && hasPerm('bizWarningAck')">
						<a-divider type="vertical" />
						<a @click="ackOne(record)">确认</a>
					</template>
					<template v-if="record.status !== 'closed' && hasPerm('bizWarningClose')">
						<a-divider type="vertical" />
						<a @click="openCloseModal(record)" style="color: #fa8c16">关闭</a>
					</template>
					<template v-if="hasPerm('bizWarningDelete')">
						<a-divider type="vertical" />
						<a-popconfirm title="确定删除此预警记录？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small">删除</a-button>
						</a-popconfirm>
					</template>
				</template>
			</template>
		</s-table>
	</a-card>
	<a-modal v-model:open="closeVisible" title="关闭学业预警" :confirm-loading="closeLoading" @ok="submitClose">
		<a-form layout="vertical">
			<a-form-item label="关闭说明：">
				<a-textarea v-model:value="closePayload.closeNote" :rows="3" placeholder="请输入关闭原因（如已补录或人工核销）" />
			</a-form-item>
		</a-form>
	</a-modal>
	<a-drawer v-model:open="detailVisible" title="学业预警规则快照与明细" width="560">
		<a-descriptions bordered :column="1" size="small" v-if="detailRow">
			<a-descriptions-item label="学生">{{ detailRow.studentNo }} - {{ detailRow.studentName }}（{{ detailRow.className }}）</a-descriptions-item>
			<a-descriptions-item label="指标 / 窗口">{{ metricLabel(detailRow.metric) }} / {{ windowLabel(detailRow.windowType) }}</a-descriptions-item>
			<a-descriptions-item label="统计周期">{{ detailRow.periodStart }} ~ {{ detailRow.periodEnd }}</a-descriptions-item>
			<a-descriptions-item label="触发摘要">{{ formatSummary(detailRow.triggerSummary) }}</a-descriptions-item>
			<a-descriptions-item label="命中规则说明">{{ formatRuleSnapshot(detailRow.ruleSnapshotJson) }}</a-descriptions-item>
			<a-descriptions-item label="触发明细">{{ formatTriggerDetail(detailRow.triggerDetailJson) }}</a-descriptions-item>
		</a-descriptions>
	</a-drawer>
</template>

<script setup name="bizWarningLedger">
	import { message } from 'ant-design-vue'
	import bizWarningApi from '@/api/biz/bizWarningApi'

	const columns = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '指标', dataIndex: 'metric' },
		{ title: '窗口', dataIndex: 'windowType' },
		{ title: '等级', dataIndex: 'level' },
		{ title: '触发摘要', dataIndex: 'triggerSummary', ellipsis: true },
		{ title: '状态', dataIndex: 'status' },
		{ title: '触发时间', dataIndex: 'createTime' },
		{ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 210 }
	]

	const tableRef = ref(null)
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const scanning = ref(false)
	const closeVisible = ref(false)
	const closeLoading = ref(false)
	const closePayload = ref({ id: '', closeNote: '' })
	const detailVisible = ref(false)
	const detailRow = ref(null)

	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const METRIC_ZH = {
		absent: '缺勤',
		late: '迟到',
		early_leave: '早退',
		leave: '请假',
		homework_not_submit: '作业未交',
		homework_late_submit: '作业迟交',
		class_behavior: '课堂违纪',
		warning_total: '累计预警',
		unacknowledged: '未确认预警',
		failed_courses: '挂科门数',
		credits: '已修学分',
		gpa: '平均绩点'
	}
	const WINDOW_ZH = { day: '日', week: '周', month: '月', term: '学期' }
	const metricLabel = (m) => METRIC_ZH[m] || m || '-'
	const windowLabel = (w) => WINDOW_ZH[w] || w || '-'
	const formatSummary = (txt) => {
		if (!txt) return '-'
		let out = String(txt)
		Object.entries(WINDOW_ZH).forEach(([k, v]) => {
			out = out.replaceAll(`[${k}/`, `[${v}/`)
		})
		Object.entries(METRIC_ZH)
			.sort((a, b) => b[0].length - a[0].length)
			.forEach(([k, v]) => {
				out = out.replaceAll(k, v)
			})
		return out
	}
	const formatRuleSnapshot = (raw) => {
		if (!raw) return '-'
		try {
			const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
			const scopeText = obj.scope === 'college' ? '学院覆盖' : '全校默认'
			return `作用域：${scopeText} ｜ 指标：${metricLabel(obj.metric)} ｜ 窗口：${windowLabel(obj.windowType || obj.window)} ｜ 等级：${levelLabel(obj.level)} ｜ 阈值：${obj.threshold ?? '-'} ｜ 版本：${obj.ruleVersion ?? obj.rule_version ?? '-'}`
		} catch (e) {
			return formatSummary(raw)
		}
	}
	const formatTriggerDetail = (raw) => {
		if (!raw) return '-'
		try {
			const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
			const count = obj.violation_count ?? obj.count ?? '-'
			const th = obj.threshold ?? '-'
			return `指标：${metricLabel(obj.metric)} ｜ 窗口：${windowLabel(obj.windowType || obj.window)} ｜ 累计值：${count} ｜ 触发阈值：${th}`
		} catch (e) {
			return formatSummary(raw)
		}
	}
	const levelLabel = (l) => ({ yellow: '黄色', orange: '橙色', red: '红色', severe: '严重' }[l] || l)
	const levelColor = (l) => ({ yellow: 'gold', orange: 'orange', red: 'red', severe: 'magenta' }[l] || 'default')
	const statusLabel = (s) => ({ open: '待确认', acknowledged: '已确认', closed: '已关闭' }[s] || s)
	const statusColor = (s) => ({ open: 'error', acknowledged: 'processing', closed: 'default' }[s] || 'default')

	const loadData = (parameter) => bizWarningApi.warningPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const runRescan = () => {
		scanning.value = true
		bizWarningApi
			.warningRescan({})
			.then((res) => {
				message.success(`扫描学生 ${res?.studentsScanned ?? 0} 人：新生成 ${res?.warningsGenerated ?? 0} 条，升级 ${res?.warningsUpgraded ?? 0} 条，自动消除 ${res?.warningsClosed ?? 0} 条`)
				tableRef.value.refresh(true)
			})
			.finally(() => {
				scanning.value = false
			})
	}

	const ackOne = (record) => {
		bizWarningApi.warningAcknowledge({ id: record.id }).then(() => {
			message.success('已确认该预警')
			tableRef.value.refresh(true)
		})
	}

	const openCloseModal = (record) => {
		closePayload.value = { id: record.id, closeNote: '' }
		closeVisible.value = true
	}

	const submitClose = () => {
		closeLoading.value = true
		bizWarningApi
			.warningClose(closePayload.value)
			.then(() => {
				closeVisible.value = false
				message.success('预警已关闭并同步更新快照')
				tableRef.value.refresh(true)
			})
			.finally(() => {
				closeLoading.value = false
			})
	}

	const openDetail = (record) => {
		bizWarningApi.warningDetail({ id: record.id }).then((data) => {
			detailRow.value = data
			detailVisible.value = true
		})
	}

	const removeOne = (record) => {
		bizWarningApi.warningDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizWarningApi.warningDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>

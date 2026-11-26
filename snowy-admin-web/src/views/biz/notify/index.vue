<template>
	<a-card :bordered="false">
		<a-tabs v-model:activeKey="activeTab" @change="loadCurrent">
			<a-tab-pane key="jobs" tab="异步通知任务队列">
				<a-form layout="inline" :model="jobSearch" class="mb-3">
					<a-form-item label="渠道">
						<a-select v-model:value="jobSearch.channel" allowClear style="width:120px" placeholder="全部渠道">
							<a-select-option value="inbox">站内信</a-select-option>
							<a-select-option value="wechat">微信/小程序</a-select-option>
							<a-select-option value="email">邮件</a-select-option>
							<a-select-option value="sms">短信</a-select-option>
						</a-select>
					</a-form-item>
					<a-form-item label="状态">
						<a-select v-model:value="jobSearch.status" allowClear style="width:120px" placeholder="全部状态">
							<a-select-option value="queued">待分发</a-select-option>
							<a-select-option value="deferred">免打扰顺延</a-select-option>
							<a-select-option value="sent">已发送</a-select-option>
							<a-select-option value="failed">失败</a-select-option>
							<a-select-option value="cancelled">已取消/冷却跳过</a-select-option>
						</a-select>
					</a-form-item>
					<a-form-item>
						<a-space>
							<a-button type="primary" @click="loadJobs">查询</a-button>
							<a-button v-if="hasPerm('bizNotifyDispatch')" type="primary" ghost @click="openEnqueue">新建发送任务</a-button>
							<a-button v-if="hasPerm('bizNotifyDispatch')" @click="handleDispatchNow">立即分发队列</a-button>
							<a-button @click="emailCfgVisible = true">邮件服务器配置</a-button>
						</a-space>
					</a-form-item>
				</a-form>

				<a-table :dataSource="jobList" :loading="loading" size="small" rowKey="id" :pagination="jobPagination" @change="onJobTableChange">
					<a-table-column title="渠道" dataIndex="channel" width="90">
						<template #default="{ text }"><a-tag color="blue">{{ channelLabel(text) }}</a-tag></template>
					</a-table-column>
					<a-table-column title="触发方式" dataIndex="triggerType" width="90">
						<template #default="{ text }">{{ triggerLabel(text) }}</template>
					</a-table-column>
					<a-table-column title="模板" dataIndex="templateCode" width="160" />
					<a-table-column title="状态" dataIndex="status" width="110">
						<template #default="{ text }"><a-tag :color="jobStatusColor(text)">{{ jobStatusLabel(text) }}</a-tag></template>
					</a-table-column>
					<a-table-column title="重试" dataIndex="tryCount" width="70" />
					<a-table-column title="冷却键" dataIndex="cooldownKey" width="140" ellipsis />
					<a-table-column title="调度时间" dataIndex="scheduleAt" width="160" />
					<a-table-column title="最近说明" dataIndex="lastError" ellipsis />
					<a-table-column title="操作" key="action" width="110">
						<template #default="{ record }">
							<a-button v-if="hasPerm('bizNotifyManage') && record.status === 'queued'" type="link" danger size="small" @click="handleCancel(record)">取消</a-button>
						</template>
					</a-table-column>
				</a-table>
			</a-tab-pane>

			<a-tab-pane key="logs" tab="通知回执日志">
				<a-form layout="inline" :model="logSearch" class="mb-3">
					<a-form-item label="接收人">
						<a-input v-model:value="logSearch.searchKey" allowClear placeholder="接收人/内容" />
					</a-form-item>
					<a-form-item>
						<a-button type="primary" @click="loadLogs">查询</a-button>
					</a-form-item>
				</a-form>
				<a-table :dataSource="logList" :loading="loading" size="small" rowKey="id" :pagination="logPagination" @change="onLogTableChange">
					<a-table-column title="任务ID" dataIndex="jobId" width="170" />
					<a-table-column title="渠道" dataIndex="channel" width="90">
						<template #default="{ text }"><a-tag color="blue">{{ channelLabel(text) }}</a-tag></template>
					</a-table-column>
					<a-table-column title="接收者" dataIndex="receiver" width="150" />
					<a-table-column title="发送状态" dataIndex="sendStatus" width="90">
						<template #default="{ text }"><a-tag :color="text === 'sent' ? 'green' : 'red'">{{ text === 'sent' ? '已发送' : '失败' }}</a-tag></template>
					</a-table-column>
					<a-table-column title="内容快照" dataIndex="contentSnapshot" ellipsis />
					<a-table-column title="发送时间" dataIndex="sentAt" width="160" />
					<a-table-column title="确认" key="ack" width="90">
						<template #default="{ record }">
							<a-tag v-if="record.acknowledged === 1" color="green">已确认</a-tag>
							<a-button v-else type="link" size="small" @click="handleAck(record)">确认回执</a-button>
						</template>
					</a-table-column>
				</a-table>
			</a-tab-pane>
		</a-tabs>

		<a-modal v-model:open="enqueueVisible" title="发送教学/预警通知" @ok="submitEnqueue" :confirmLoading="submitting">
			<a-form :model="enqueueForm" layout="vertical">
				<a-form-item label="渠道">
					<a-select v-model:value="enqueueForm.channel">
						<a-select-option value="inbox">站内信</a-select-option>
						<a-select-option value="wechat">微信/小程序(同步站内信)</a-select-option>
						<a-select-option value="email">邮件</a-select-option>
						<a-select-option value="sms">短信</a-select-option>
					</a-select>
				</a-form-item>
				<a-form-item label="接收人ID或邮箱/手机号(逗号分隔)">
					<a-input v-model:value="enqueueForm.receiversText" placeholder="例: 1900200000000000804" />
				</a-form-item>
				<a-form-item label="通知标题">
					<a-input v-model:value="enqueueForm.title" />
				</a-form-item>
				<a-form-item label="通知正文">
					<a-textarea v-model:value="enqueueForm.content" :rows="3" />
				</a-form-item>
				<a-form-item label="立即分发">
					<a-switch v-model:checked="enqueueForm.dispatchNow" />
				</a-form-item>
			</a-form>
		</a-modal>
		<a-drawer v-model:open="emailCfgVisible" title="邮件服务器配置（本地SMTP / 阿里云 / 腾讯云）" width="760" destroy-on-close>
			<EmailConfigPanel />
		</a-drawer>
	</a-card>
</template>

<script setup name="bizNotify">
import { message } from 'ant-design-vue'
import bizNotifyApi from '@/api/biz/bizNotifyApi'
import EmailConfigPanel from '@/views/dev/config/emailConfig/index.vue'

const emailCfgVisible = ref(false)
const channelLabel = (c) => ({ inbox: '站内信', wechat: '微信/小程序', email: '邮件', sms: '短信', app: '应用推送' }[c] || c)
const triggerLabel = (t) => ({ manual: '手动发送', auto: '预警自动', rule: '规则触发' }[t] || t)
const jobStatusLabel = (s) => ({ queued: '待分发', deferred: '免打扰顺延', sent: '已发送', completed: '部分成功', failed: '发送失败', cancelled: '已取消' }[s] || s)
const jobStatusColor = (s) => ({ queued: 'processing', deferred: 'gold', sent: 'green', completed: 'cyan', failed: 'red', cancelled: 'default' }[s] || 'default')

const activeTab = ref('jobs')
const loading = ref(false)
const jobList = ref([])
const logList = ref([])
const jobSearch = reactive({ channel: undefined, status: undefined, current: 1, size: 10 })
const logSearch = reactive({ searchKey: '', current: 1, size: 10 })
const jobPagination = reactive({ current: 1, pageSize: 10, total: 0 })
const logPagination = reactive({ current: 1, pageSize: 10, total: 0 })

const enqueueVisible = ref(false)
const submitting = ref(false)
const enqueueForm = reactive({ channel: 'inbox', receiversText: '', title: '学业预警提醒', content: '', dispatchNow: true })

const loadJobs = async () => {
	loading.value = true
	try {
		const res = await bizNotifyApi.jobPage({ ...jobSearch, current: jobPagination.current, size: jobPagination.pageSize })
		jobList.value = res?.records || []
		jobPagination.total = res?.total || 0
	} finally {
		loading.value = false
	}
}

const loadLogs = async () => {
	loading.value = true
	try {
		const res = await bizNotifyApi.logPage({ ...logSearch, current: logPagination.current, size: logPagination.pageSize })
		logList.value = res?.records || []
		logPagination.total = res?.total || 0
	} finally {
		loading.value = false
	}
}

const loadCurrent = () => (activeTab.value === 'jobs' ? loadJobs() : loadLogs())
const onJobTableChange = (p) => { jobPagination.current = p.current; loadJobs() }
const onLogTableChange = (p) => { logPagination.current = p.current; loadLogs() }

const openEnqueue = () => { enqueueVisible.value = true }
const submitEnqueue = async () => {
	const receivers = enqueueForm.receiversText.split(',').map((s) => s.trim()).filter(Boolean)
	if (!receivers.length) return message.warning('请填写至少一个接收人')
	submitting.value = true
	try {
		await bizNotifyApi.enqueue({
			channel: enqueueForm.channel,
			receivers,
			title: enqueueForm.title,
			content: enqueueForm.content,
			dispatchNow: enqueueForm.dispatchNow
		})
		message.success('通知任务已提交')
		enqueueVisible.value = false
		loadJobs()
	} finally {
		submitting.value = false
	}
}

const handleDispatchNow = async () => {
	const res = await bizNotifyApi.dispatchNow()
	message.success(`处理 ${res?.processed || 0} 条，成功 ${res?.sent || 0} 条`)
	loadJobs()
}

const handleCancel = async (record) => {
	await bizNotifyApi.cancelJob({ id: record.id })
	message.success('已取消')
	loadJobs()
}

const handleAck = async (record) => {
	await bizNotifyApi.ackLog({ id: record.id })
	message.success('已确认')
	loadLogs()
}

onMounted(loadJobs)
</script>

<style scoped>
.mb-3 { margin-bottom: 12px; }
</style>

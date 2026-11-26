<template>
	<a-card :bordered="false">
		<a-form layout="inline" class="mb-3">
			<a-form-item label="报表类型">
				<a-select v-model:value="exportForm.reportType" style="width:170px">
					<a-select-option value="daily">每日考勤表现报表</a-select-option>
					<a-select-option value="weekly">周度考勤汇总报表</a-select-option>
					<a-select-option value="monthly">月度考勤汇总报表</a-select-option>
					<a-select-option value="semester">学期成绩学分汇总</a-select-option>
					<a-select-option value="student_accounts">学生初始账号密码单</a-select-option>
				</a-select>
			</a-form-item>
			<a-form-item label="导出范围">
				<a-select v-model:value="exportForm.scopeType" style="width:130px" @change="onScopeTypeChange">
					<a-select-option value="school">全校范围</a-select-option>
					<a-select-option value="org">指定学院</a-select-option>
					<a-select-option value="class">指定班级</a-select-option>
				</a-select>
			</a-form-item>
			<a-form-item v-if="exportForm.scopeType === 'org'" label="选择学院">
				<a-select
					v-model:value="exportForm.scopeId"
					:options="orgOptions"
					:field-names="{ label: 'name', value: 'id' }"
					placeholder="留空默认本学院"
					allow-clear
					show-search
					option-filter-prop="name"
					style="width:200px"
				/>
			</a-form-item>
			<a-form-item v-if="exportForm.scopeType === 'class'" label="选择班级">
				<a-select
					v-model:value="exportForm.scopeId"
					:options="classOptions"
					:field-names="{ label: 'className', value: 'id' }"
					placeholder="请选择导出班级"
					allow-clear
					show-search
					option-filter-prop="className"
					style="width:200px"
				/>
			</a-form-item>
			<a-form-item>
				<a-space>
					<a-button v-if="hasPerm('bizReportExport')" type="primary" :loading="exporting" @click="handleExport">生成报表</a-button>
					<a-button @click="loadList">刷新列表</a-button>
				</a-space>
			</a-form-item>
		</a-form>

		<a-table :dataSource="list" :loading="loading" size="small" rowKey="id" :pagination="pagination" @change="onTableChange">
			<a-table-column title="报表类型" dataIndex="reportType" width="160">
				<template #default="{ text }">{{ reportTypeLabel(text) }}</template>
			</a-table-column>
			<a-table-column title="导出范围" dataIndex="scopeType" width="100">
				<template #default="{ text }"><a-tag color="blue">{{ scopeTypeLabel(text) }}</a-tag></template>
			</a-table-column>
			<a-table-column title="文件名" dataIndex="fileName" ellipsis />
			<a-table-column title="状态" dataIndex="status" width="100">
				<template #default="{ text }"><a-tag :color="statusColor(text)">{{ statusLabel(text) }}</a-tag></template>
			</a-table-column>
			<a-table-column title="创建时间" dataIndex="createTime" width="170" />
			<a-table-column title="操作" key="action" width="150">
				<template #default="{ record }">
					<a-space>
						<a-button v-if="record.fileId" type="link" size="small" @click="handleDownload(record)">下载报表</a-button>
						<span v-else style="color: #999; font-size: 12px">无文件</span>
						<a-button v-if="hasPerm('bizReportDelete')" type="link" danger size="small" @click="handleDelete(record)">删除</a-button>
					</a-space>
				</template>
			</a-table-column>
		</a-table>
	</a-card>
</template>

<script setup name="bizReport">
import { message } from 'ant-design-vue'
import bizReportApi from '@/api/biz/bizReportApi'
import bizClassApi from '@/api/biz/bizClassApi'
import downloadUtil from '@/utils/downloadUtil'

const loading = ref(false)
const exporting = ref(false)
const list = ref([])
const orgOptions = ref([])
const classOptions = ref([])
const pagination = reactive({ current: 1, pageSize: 10, total: 0 })
const exportForm = reactive({ reportType: 'weekly', scopeType: 'org', scopeId: undefined })

const reportTypeLabel = (t) => ({
	daily: '每日考勤表现报表',
	weekly: '周度考勤汇总报表',
	monthly: '月度考勤汇总报表',
	semester: '学期成绩学分汇总',
	student_accounts: '学生初始账号密码单'
}[t] || t)
const scopeTypeLabel = (s) => ({ school: '全校', org: '学院', class: '班级' }[s] || s)
const statusLabel = (s) => ({ completed: '已完成', success: '已完成', processing: '生成中', failed: '失败' }[s] || s)
const statusColor = (s) => ({ completed: 'green', success: 'green', processing: 'processing', failed: 'red' }[s] || 'default')

const loadOptions = () => {
	bizClassApi.orgTreeSelector().then((tree) => {
		const flat = []
		const walk = (nodes) => {
			;(nodes || []).forEach((n) => {
				if (n.parentId !== '0') flat.push({ id: n.id, name: n.name })
				if (n.children) walk(n.children)
			})
		}
		walk(tree)
		orgOptions.value = flat
	}).catch(() => {})
	bizClassApi.clazzList({}).then((rows) => {
		classOptions.value = rows || []
	}).catch(() => {})
}

const onScopeTypeChange = () => {
	exportForm.scopeId = undefined
}

const loadList = async () => {
	loading.value = true
	try {
		const res = await bizReportApi.page({ current: pagination.current, size: pagination.pageSize })
		list.value = res?.records || []
		pagination.total = res?.total || 0
	} finally {
		loading.value = false
	}
}

const onTableChange = (p) => { pagination.current = p.current; loadList() }

const handleExport = async () => {
	if (exportForm.scopeType === 'class' && !exportForm.scopeId) {
		return message.warning('请先选择要导出的班级')
	}
	exporting.value = true
	try {
		const res = await bizReportApi.exportReport({ ...exportForm })
		message.success(`导出成功：${res?.fileName} (${res?.rowCount || 0}行)`)
		loadList()
	} finally {
		exporting.value = false
	}
}

const handleDownload = async (record) => {
	try {
		const res = await bizReportApi.downloadReport({ id: record.id })
		if (!res) return
		downloadUtil.resultDownload(res)
	} catch (e) {
		message.error('报表下载失败，请稍后重试')
	}
}

const handleDelete = async (record) => {
	await bizReportApi.deleteReport([{ id: record.id }])
	message.success('已删除')
	loadList()
}

onMounted(() => {
	loadOptions()
	loadList()
})
</script>

<style scoped>
.mb-3 { margin-bottom: 12px; }
</style>

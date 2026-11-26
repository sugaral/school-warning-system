<template>
	<XnResizablePanel direction="row" :initial-size="280" :min-size="200" :max-size="450" :md="0">
		<template #left>
			<div ref="treeContainerRef" style="height: 100%; display: flex; flex-direction: column">
				<a-input-search
					v-model:value="treeSearchKey"
					placeholder="搜索学院"
					allow-clear
					style="margin-bottom: 8px; flex-shrink: 0"
					@search="onTreeSearch"
				/>
				<div style="flex: 1; overflow: hidden">
					<xn-tree-skeleton v-if="treeLoading && treeData.length === 0" />
					<a-spin v-else-if="treeData.length > 0" :spinning="treeLoading">
						<a-tree
							v-model:expandedKeys="defaultExpandedKeys"
							v-model:loadedKeys="treeLoadedKeys"
							:show-line="{ showLeafIcon: false }"
							:tree-data="treeData"
							:field-names="treeFieldNames"
							:load-data="searchMode ? undefined : onLoadData"
							:height="treeHeight"
							@select="treeSelect"
						/>
					</a-spin>
					<a-empty v-else :image="Empty.PRESENTED_IMAGE_SIMPLE" />
				</div>
			</div>
		</template>
		<template #right>
			<a-form ref="searchFormRef" :model="searchFormState">
				<a-row :gutter="10">
					<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
						<a-form-item name="searchKey" label="关键词">
							<a-input v-model:value="searchFormState.searchKey" placeholder="学号或姓名" allow-clear />
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
						<a-form-item name="classId" label="班级">
							<a-select
								v-model:value="searchFormState.classId"
								:options="classOptions"
								:field-names="{ label: 'className', value: 'id' }"
								placeholder="全部班级"
								show-search
								option-filter-prop="className"
								allow-clear
							/>
						</a-form-item>
					</a-col>
					<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
						<a-form-item name="status" label="状态">
							<a-select v-model:value="searchFormState.status" placeholder="全部" allow-clear>
								<a-select-option value="active">在读</a-select-option>
								<a-select-option value="inactive">休学/停用</a-select-option>
								<a-select-option value="graduated">已毕业</a-select-option>
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
						<a-button type="primary" @click="formRef.onOpen(undefined, searchFormState.classId)" v-if="hasPerm('bizStudentAdd')">
							<template #icon><plus-outlined /></template>
							新增
						</a-button>
						<a-button @click="importModalRef.onOpen()" v-if="hasPerm('bizStudentImport')">
							<template #icon><UploadOutlined /></template>
							批量导入
						</a-button>
						<a-button @click="handleExportAccounts" v-if="hasPerm('bizStudentExport')">
							<template #icon><DownloadOutlined /></template>
							导出账号密码
						</a-button>
						<xn-batch-button
							v-if="hasPerm('bizStudentBatchDelete')"
							buttonName="批量删除"
							icon="DeleteOutlined"
							buttonDanger
							:selectedRowKeys="selectedRowKeys"
							@batchCallBack="deleteBatch"
						/>
					</a-space>
				</template>
				<template #bodyCell="{ column, record }">
					<template v-if="column.dataIndex === 'wechatBound'">
						<a-tag :color="record.wechatBound ? 'green' : 'default'">
							{{ record.wechatBound ? '已绑定' : '未绑定' }}
						</a-tag>
					</template>
					<template v-if="column.dataIndex === 'status'">
						<a-tag :color="record.status === 'active' ? 'green' : record.status === 'graduated' ? 'blue' : 'default'">
							{{ record.status === 'active' ? '在读' : record.status === 'graduated' ? '已毕业' : '停用' }}
						</a-tag>
					</template>
					<template v-if="column.dataIndex === 'action'">
						<a-space size="small">
							<a @click="formRef.onOpen(record)" v-if="hasPerm('bizStudentEdit')">编辑</a>
							<a-popconfirm title="确定重置该学生密码并强制下线？" @confirm="handleResetPassword(record)">
								<a v-if="hasPerm('bizStudentResetPwd')">重置密码</a>
							</a-popconfirm>
							<a-popconfirm
								v-if="record.wechatBound && hasPerm('bizStudentUnbindWechat')"
								title="确定解绑该学生微信？"
								@confirm="handleUnbindWechat(record)"
							>
								<a>解绑微信</a>
							</a-popconfirm>
							<a-popconfirm title="确定删除该学生及其关联流水数据？" @confirm="removeOne(record)">
								<a-button type="link" danger size="small" v-if="hasPerm('bizStudentDelete')">删除</a-button>
							</a-popconfirm>
						</a-space>
					</template>
				</template>
			</s-table>
		</template>
	</XnResizablePanel>
	<Form ref="formRef" @successful="onFormSuccess" />
	<BizImportModal
		ref="importModalRef"
		title="批量导入学生档案"
		:template-api="bizStudentApi.studentImportTemplate"
		:import-api="bizStudentApi.studentImport"
		@successful="tableRef.refresh(true)"
	/>
</template>

<script setup name="bizStudent">
	import { Empty, Modal, message } from 'ant-design-vue'
	import bizStudentApi from '@/api/biz/bizStudentApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import downloadUtil from '@/utils/downloadUtil'
	import { useOrgTree } from '@/views/biz/components/useOrgTree'
	import BizImportModal from '@/views/biz/components/BizImportModal.vue'
	import Form from './form.vue'

	const columns = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'name' },
		{ title: '性别', dataIndex: 'gender' },
		{ title: '所属学院', dataIndex: 'orgName' },
		{ title: '所属班级', dataIndex: 'className' },
		{ title: '手机号', dataIndex: 'mobile' },
		{ title: '微信绑定', dataIndex: 'wechatBound' },
		{ title: '状态', dataIndex: 'status' }
	]
	if (hasPerm(['bizStudentEdit', 'bizStudentResetPwd', 'bizStudentUnbindWechat', 'bizStudentDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 260 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const importModalRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const classOptions = ref([])
	const selectedRowKeys = ref([])
	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const loadClasses = (orgId) => {
		bizClassApi.clazzList(orgId ? { orgId } : {}).then((res) => {
			classOptions.value = res || []
		})
	}
	loadClasses()

	const {
		treeData,
		treeLoading,
		treeSearchKey,
		searchMode,
		defaultExpandedKeys,
		treeLoadedKeys,
		treeContainerRef,
		treeHeight,
		treeFieldNames,
		onTreeSearch,
		onLoadData,
		treeSelect
	} = useOrgTree(bizStudentApi.orgTreeSelector, (orgId) => {
		if (orgId) searchFormState.value.orgId = orgId
		else delete searchFormState.value.orgId
		delete searchFormState.value.classId
		loadClasses(orgId)
		tableRef.value.refresh(true)
	})

	const loadData = (parameter) => bizStudentApi.studentPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		delete searchFormState.value.orgId
		loadClasses()
		tableRef.value.refresh(true)
	}

	const onFormSuccess = (res) => {
		if (res && res.initialPassword) {
			Modal.success({
				title: '学生创建成功',
				content: `学号：${res.studentNo}，系统生成初始密码：${res.initialPassword}（请妥善告知学生）`
			})
		}
		tableRef.value.refresh(true)
	}

	const handleResetPassword = (record) => {
		bizStudentApi.studentResetPassword({ id: record.id }).then((res) => {
			if (res && res.initialPassword) {
				Modal.success({
					title: '密码重置成功',
					content: `${res.name}（${res.studentNo}）新初始密码：${res.initialPassword}`
				})
			}
		})
	}

	const handleUnbindWechat = (record) => {
		bizStudentApi.studentUnbindWechat({ id: record.id }).then(() => {
			message.success('微信解绑成功')
			tableRef.value.refresh(true)
		})
	}

	const handleExportAccounts = () => {
		bizStudentApi.studentExportAccounts(searchFormState.value).then((res) => {
			downloadUtil.resultDownload(res)
		})
	}

	const removeOne = (record) => {
		bizStudentApi.studentDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizStudentApi.studentDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>

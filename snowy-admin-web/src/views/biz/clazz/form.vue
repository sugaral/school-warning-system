<template>
	<xn-form-container
		:title="formData.id ? '编辑班级' : '新增班级'"
		:width="560"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="所属学院：" name="orgId">
				<a-tree-select
					v-model:value="formData.orgId"
					class="xn-wd"
					placeholder="请选择学院"
					:tree-data="treeData"
					:field-names="{ children: 'children', label: 'name', value: 'id' }"
					:load-data="onLoadData"
					tree-line
					allow-clear
					@change="onOrgChange"
				/>
			</a-form-item>
			<a-form-item label="关联专业：" name="majorId">
				<a-select
					v-model:value="formData.majorId"
					:options="majorOptions"
					:field-names="{ label: 'name', value: 'id' }"
					placeholder="请选择专业（选填）"
					allow-clear
					@change="onMajorChange"
				/>
			</a-form-item>
			<a-form-item label="专业名称：" name="major">
				<a-input v-model:value="formData.major" placeholder="自动带出或手工填写专业名称" allow-clear />
			</a-form-item>
			<a-form-item label="班级名称：" name="className">
				<a-input v-model:value="formData.className" placeholder="例如：2025级软件工程一班" allow-clear />
			</a-form-item>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="入学年份：" name="enrollYear">
						<a-input-number v-model:value="formData.enrollYear" class="xn-wd" :min="2000" :max="2100" />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="年级层次：" name="gradeLevel">
						<a-input v-model:value="formData.gradeLevel" placeholder="如：2025级/本科" allow-clear />
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="班主任：" name="counselorUserId">
				<a-select
					v-model:value="formData.counselorUserId"
					:options="teacherOptions"
					:field-names="{ label: 'name', value: 'id' }"
					placeholder="请选择班主任（选填）"
					show-search
					option-filter-prop="name"
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="状态：" name="status">
				<a-radio-group v-model:value="formData.status">
					<a-radio value="active">启用</a-radio>
					<a-radio value="inactive">停用</a-radio>
				</a-radio-group>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizClazzForm">
	import { required } from '@/utils/formRules'
	import bizClassApi from '@/api/biz/bizClassApi'
	import bizMajorApi from '@/api/biz/bizMajorApi'

	defineProps({
		treeData: { type: Array, default: () => [] },
		onLoadData: { type: Function, default: undefined }
	})
	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const majorOptions = ref([])
	const teacherOptions = ref([])

	const formRules = {
		orgId: [required('请选择所属学院')],
		className: [required('请输入班级名称')],
		enrollYear: [required('请输入入学年份')]
	}

	const loadMajors = (orgId) => {
		bizMajorApi.majorList(orgId ? { orgId } : {}).then((res) => {
			majorOptions.value = res || []
		})
	}

	const loadTeachers = (orgId) => {
		bizClassApi.userSelector({ orgId, size: 200 }).then((res) => {
			teacherOptions.value = (res && res.records) || []
		})
	}

	const onOrgChange = (orgId) => {
		formData.value.majorId = undefined
		loadMajors(orgId)
		loadTeachers(orgId)
	}

	const onMajorChange = (majorId) => {
		const matched = majorOptions.value.find((m) => m.id === majorId)
		if (matched) formData.value.major = matched.name
	}

	const onOpen = (record, orgId) => {
		visible.value = true
		formData.value = { status: 'active', enrollYear: new Date().getFullYear() }
		if (orgId) formData.value.orgId = orgId
		if (record) formData.value = Object.assign({}, record)
		loadMajors(formData.value.orgId)
		loadTeachers(formData.value.orgId)
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizClassApi
					.submitForm(formData.value, !!formData.value.id)
					.then(() => {
						visible.value = false
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
